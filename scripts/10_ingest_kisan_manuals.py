"""
10_ingest_kisan_manuals.py -- builds the Kisan Sahayak RAG corpus:
downloads real ICAR/KVK/state-department/IMD PDFs, extracts text
(pdfplumber), chunks it, embeds each chunk with Workers AI, and upserts
into a Cloudflare Vectorize index. This is what kisan_sahayak_worker.js's
search_manuals tool queries at runtime.

--------------------------------------------------------------------------
ONE-TIME SETUP (run yourself -- this session cannot touch your Cloudflare
account; wrangler CLI and the Cloudflare API are both blocked here):

    npm install -g wrangler          # if you don't already have it
    wrangler login
    wrangler vectorize create kisan-sahayak-manuals --dimensions=768 --metric=cosine

  The index name (kisan-sahayak-manuals) and the binding name
  (VECTORIZE_INDEX) are a contract shared by THREE files -- keep all three
  in sync if you ever rename either:
    - this script's VECTORIZE_INDEX_NAME constant below (used in the REST
      API URL, since this script talks to Vectorize over HTTP, not via a
      Worker binding)
    - cloudflare/wrangler_kisan_sahayak.toml's [[vectorize]] block
    - cloudflare/kisan_sahayak_worker.js's env.VECTORIZE_INDEX usage

ENV VARS this script needs (never hardcode these -- same rule as every
other credential in this repo):
    CLOUDFLARE_ACCOUNT_ID   -- Cloudflare dashboard right sidebar
    CLOUDFLARE_API_TOKEN    -- My Profile -> API Tokens -> Create Token,
                               scoped to "Workers AI:Read" + "Vectorize:Edit"
                               (do NOT reuse a token with wider scope)

USAGE:
    python 10_ingest_kisan_manuals.py                       # ingest the whole CORPUS below
    python 10_ingest_kisan_manuals.py --dry-run              # fetch+extract+chunk, print counts, no embed/upsert (no Cloudflare creds needed)
    python 10_ingest_kisan_manuals.py --only wheat_pop_1984  # one document, by its `id` in CORPUS

--------------------------------------------------------------------------
HONEST COVERAGE (checked 2026-08-08 -- full retry log in
docs/KISAN_SAHAYAK_RAG.md, do not silently expand this claim without
updating that file too):

  6 real, freely-published, government/ICAR-institute PDFs, verified with
  a live HTTP fetch this session (200 OK, correct content-type) --
  covering wheat and rice Package-of-Practices, one state organic-farming
  PoP, one national kharif agro-advisory circular, and two IMD state
  agromet advisory bulletins (rolling documents, re-fetch periodically).

  NOT ingested, with the real reason (checked this session, not assumed):
    - krishi.icar.gov.in -- ICAR's own PoP archive (deepest known source,
      has PDFs for hybrid rice, hybrid rice seed production, and more per
      a live web search) -- every direct fetch attempt returned a DNS
      resolution failure (curl exit 6) from this environment. The URLs are
      real (found via web search, not guessed); re-try this host directly.
    - kvk.icar.gov.in -- same DNS failure, same real-PDF-but-unreachable
      situation (e.g. .../API/Content/PPupload/k0306_1.pdf for paddy).
    - icar-nrri.in -- same DNS failure.
    - NPSS (npss.dac.gov.in) -- portal resolves (HTTP 200) but no public
      API/bulk-data endpoint was found (several common paths -- /api/,
      /swagger-ui.html -- all 404); not a document corpus source anyway,
      out of scope for this script, noted here only for the record.

  This is a real-but-partial corpus by design (task instruction: "a
  working pipeline with 5-10 real documents beats an ambitious one that
  ingested nothing"). Re-run with an expanded CORPUS list once the above
  hosts resolve, or once more real PDFs are found by hand -- do not
  fabricate a placeholder entry to pad the count.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"  # 768-dim, must match kisan_sahayak_worker.js's EMBEDDING_MODEL
VECTORIZE_INDEX_NAME = "kisan-sahayak-manuals"  # must match wrangler_kisan_sahayak.toml's index_name
EMBED_BATCH_SIZE = 20     # Workers AI embedding calls accept an array of texts per request
UPSERT_BATCH_SIZE = 200   # Vectorize REST insert/upsert body size
CHUNK_WORDS = 500
CHUNK_OVERLAP_WORDS = 75
TIMEOUT = 45

# --------------------------------------------------------------------
# The corpus. Every URL here was fetched live and confirmed 200 OK with
# application/pdf content-type on 2026-08-08 -- see the header note above
# for what was tried and excluded.
# --------------------------------------------------------------------
CORPUS = [
    {
        "id": "wheat_pop_1984",
        "url": "https://iiwbr.org.in/wp-content/uploads/2023/08/Wheat-Package-of-practices-for-increasing-production-1984.pdf",
        "source": "ICAR-IIWBR: Package of Practices for Increasing Wheat Production",
        "crop": "wheat",
        "year": 1984,
        "publisher": "ICAR-Indian Institute of Wheat and Barley Research (IIWBR)",
    },
    {
        "id": "organic_pop_maharashtra",
        "url": "https://agriwelfare.gov.in/Documents/POP%20Maharastra.pdf",
        "source": "Package of Practices for Organic Farming, Maharashtra",
        "crop": "multiple (organic farming)",
        "year": None,  # not stated in the document itself
        "publisher": "Dept. of Agriculture and Farmers Welfare (agriwelfare.gov.in)",
    },
    {
        "id": "crri_direct_seeded_rice_2025",
        "url": "https://icar-crri.in/wp-content/uploads/2025/12/CRRI_Technology-Bulletin_No-250.pdf",
        "source": "CRRI Technology Bulletin No. 250: Package and Practices for Direct Seeded Rice",
        "crop": "rice",
        "year": 2025,
        "publisher": "ICAR-Central Rice Research Institute (CRRI)",
    },
    {
        "id": "icar_kharif_agro_advisories_2025",
        "url": "https://icar.org.in/sites/default/files/Circulars/ICAR-En-Kharif-Agro-Advisories-for-Farmers-2025.pdf",
        "source": "ICAR Kharif Agro-Advisories for Farmers 2025",
        "crop": "multiple (kharif)",
        "year": 2025,
        "publisher": "Indian Council of Agricultural Research (ICAR)",
    },
    {
        "id": "imd_agromet_gujarat",
        "url": "https://mausam.imd.gov.in/ahmedabad/mcdata/agromet.pdf",
        "source": "IMD Agromet Advisory Service Bulletin -- Gujarat",
        "crop": "multiple (state agromet advisory)",
        "year": None,  # rolling bulletin, re-issued twice weekly -- see fetch_date instead
        "publisher": "India Meteorological Department (IMD), Gramin Krishi Mausam Sewa",
    },
    {
        "id": "imd_agromet_assam",
        "url": "https://mausam.imd.gov.in/guwahati/mcdata/ams_bulletin_en.pdf",
        "source": "IMD Agromet Advisory Service Bulletin -- Assam",
        "crop": "multiple (state agromet advisory)",
        "year": None,
        "publisher": "India Meteorological Department (IMD), Gramin Krishi Mausam Sewa",
    },
]

FETCH_DATE = time.strftime("%Y-%m-%d")


def log(msg: str) -> None:
    print(f"[10_ingest_kisan_manuals] {msg}", file=sys.stderr)


def fetch_pdf_bytes(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "VindhyaClimatePortal-KisanSahayak/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        log(f"FAILED fetching {url}: {e}")
        return None


def extract_pages(pdf_bytes: bytes) -> list[str]:
    """Returns a list of page texts (1-indexed by position). Never
    fabricates text for a page that fails to extract -- an empty/failed
    page is an empty string, dropped later, not padded."""
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is not installed -- `pip install pdfplumber` (now in requirements.txt)")
    pages = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            try:
                text = page.extract_text() or ""
            except Exception as e:
                log(f"  page extract failed: {e}")
                text = ""
            pages.append(text)
    return pages


def chunk_pages(pages: list[str], doc: dict) -> list[dict]:
    """Chunks by ~CHUNK_WORDS words with CHUNK_OVERLAP_WORDS overlap,
    tracking which page(s) each chunk actually came from -- this is what
    lets search_manuals cite a real page number, never a guessed one."""
    chunks = []
    # Build one big (word, page_number) stream so a chunk boundary can span
    # pages honestly (a paragraph doesn't stop at a page break) while still
    # recording the true page range for each chunk.
    stream: list[tuple[str, int]] = []
    for page_no, text in enumerate(pages, start=1):
        for w in text.split():
            stream.append((w, page_no))
    if not stream:
        return chunks

    i = 0
    step = CHUNK_WORDS - CHUNK_OVERLAP_WORDS
    while i < len(stream):
        window = stream[i:i + CHUNK_WORDS]
        if not window:
            break
        words = [w for w, _ in window]
        page_nos = sorted(set(p for _, p in window))
        text = " ".join(words).strip()
        if len(text) >= 40:  # drop near-empty chunks (e.g. a mostly-blank page)
            chunks.append({
                "text": text,
                "page_start": page_nos[0],
                "page_end": page_nos[-1],
                **{k: doc[k] for k in ("id", "source", "crop", "year", "publisher", "url")},
            })
        i += step
    return chunks


def cf_api(path: str, method: str = "GET", body: bytes | None = None, content_type: str = "application/json"):
    if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
        raise RuntimeError("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set")
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}{path}"
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": content_type,
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read())


def embed_batch(texts: list[str]) -> list[list[float]]:
    resp = cf_api(f"/ai/run/{EMBEDDING_MODEL}", method="POST", body=json.dumps({"text": texts}).encode("utf-8"))
    result = resp.get("result", {})
    vectors = result.get("data")
    if not vectors or len(vectors) != len(texts):
        raise RuntimeError(f"embedding call returned {len(vectors) if vectors else 0} vectors for {len(texts)} texts")
    return vectors


def upsert_batch(records: list[dict]) -> None:
    """records: [{id, values, metadata}, ...] -- Vectorize's ndjson insert
    endpoint. Uses 'insert' (fails on duplicate id) on first run; re-running
    this script for the same corpus re-derives the same deterministic ids
    (doc id + chunk index), so a second run should use upsert semantics --
    Vectorize's v2 API exposes both; this script always upserts so re-runs
    after a corpus edit are safe."""
    ndjson = "\n".join(json.dumps(r) for r in records).encode("utf-8")
    cf_api(f"/vectorize/v2/indexes/{VECTORIZE_INDEX_NAME}/upsert", method="POST", body=ndjson, content_type="application/x-ndjson")


def make_chunk_id(doc_id: str, idx: int) -> str:
    return f"{doc_id}__chunk{idx:04d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="fetch+extract+chunk only, no Cloudflare calls, no creds needed")
    ap.add_argument("--only", default=None, help="ingest a single CORPUS entry by its id")
    args = ap.parse_args()

    docs = [d for d in CORPUS if (args.only is None or d["id"] == args.only)]
    if not docs:
        log(f"no CORPUS entry matches --only={args.only!r}")
        sys.exit(1)

    total_chunks = 0
    all_chunks: list[dict] = []
    per_doc_summary = []

    for doc in docs:
        log(f"fetching {doc['id']} <- {doc['url']}")
        pdf_bytes = fetch_pdf_bytes(doc["url"])
        if pdf_bytes is None:
            per_doc_summary.append({"id": doc["id"], "status": "fetch_failed"})
            continue
        try:
            pages = extract_pages(pdf_bytes)
        except Exception as e:
            log(f"  extract failed: {e}")
            per_doc_summary.append({"id": doc["id"], "status": f"extract_failed: {e}"})
            continue
        non_empty_pages = sum(1 for p in pages if p.strip())
        chunks = chunk_pages(pages, doc)
        log(f"  {len(pages)} pages ({non_empty_pages} with extractable text) -> {len(chunks)} chunks")
        all_chunks.extend(chunks)
        total_chunks += len(chunks)
        per_doc_summary.append({"id": doc["id"], "status": "ok", "pages": len(pages), "pages_with_text": non_empty_pages, "chunks": len(chunks)})

    log(f"TOTAL: {len(docs)} documents attempted, {total_chunks} chunks produced")
    for s in per_doc_summary:
        log(f"  {s}")

    if args.dry_run:
        log("--dry-run: stopping before embed/upsert. Sample chunk:")
        if all_chunks:
            sample = dict(all_chunks[0])
            sample["text"] = sample["text"][:200] + ("..." if len(sample["text"]) > 200 else "")
            log(json.dumps(sample, indent=2))
        return

    if not all_chunks:
        log("nothing to embed/upsert -- every document failed to fetch or extract")
        sys.exit(1)

    log(f"embedding {len(all_chunks)} chunks via {EMBEDDING_MODEL} (batches of {EMBED_BATCH_SIZE})...")
    records = []
    for batch_start in range(0, len(all_chunks), EMBED_BATCH_SIZE):
        batch = all_chunks[batch_start:batch_start + EMBED_BATCH_SIZE]
        vectors = embed_batch([c["text"] for c in batch])
        for local_idx, (chunk, vector) in enumerate(zip(batch, vectors)):
            global_idx = batch_start + local_idx
            records.append({
                "id": make_chunk_id(chunk["id"], global_idx),
                "values": vector,
                "metadata": {
                    "text": chunk["text"],
                    "source": chunk["source"],
                    "crop": chunk["crop"],
                    "year": chunk["year"],
                    "publisher": chunk["publisher"],
                    "url": chunk["url"],
                    "page": chunk["page_start"] if chunk["page_start"] == chunk["page_end"] else f"{chunk['page_start']}-{chunk['page_end']}",
                    "ingested_date": FETCH_DATE,
                },
            })
        log(f"  embedded {min(batch_start + EMBED_BATCH_SIZE, len(all_chunks))}/{len(all_chunks)}")

    log(f"upserting {len(records)} vectors to Vectorize index '{VECTORIZE_INDEX_NAME}' (batches of {UPSERT_BATCH_SIZE})...")
    for batch_start in range(0, len(records), UPSERT_BATCH_SIZE):
        batch = records[batch_start:batch_start + UPSERT_BATCH_SIZE]
        upsert_batch(batch)
        log(f"  upserted {min(batch_start + UPSERT_BATCH_SIZE, len(records))}/{len(records)}")

    log("done.")


if __name__ == "__main__":
    main()

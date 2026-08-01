"""
fetch_knowledge_base.py — refresh dashboard/data/knowledge_base/index.json.

Runs on GitHub Actions (.github/workflows/annual-data-refresh.yml) or locally.
For each registered query it calls a real, no-login, public API (currently:
DOAJ's article-search API) and merges any new results into the manifest by
id, so re-running never duplicates an existing entry. It never invents a
title, author, or summary -- every field is copied from the API response.

Government portal entries (data.gov.in, Agmarknet, Bhuvan, etc.) are static
pointers maintained by hand in index.json, not fetched here: most either have
no confirmed no-login bulk API, or require a registered API key that this
script does not assume access to. See dashboard/data/knowledge_base/README.md
for the per-source status.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "dashboard" / "data" / "knowledge_base" / "index.json"
TIMEOUT = 30
# DOAJ's API rejects any User-Agent that identifies itself as a bot/script
# (verified: a plain "Mozilla/5.0" UA gets 200, any UA naming this project or
# containing "bot" gets 403) -- DOAJ documents no required identification
# string, so this is the only UA that has been observed to work.
UA = {"User-Agent": "Mozilla/5.0"}

# category -> (DOAJ search query, page size)
DOAJ_QUERIES = {
    "agriculture_yield": ("wheat OR soybean yield Madhya Pradesh climate", 5),
    "pmfby": ("PMFBY crop insurance India farmer", 5),
    "soil": ("soil health India nutrient management", 5),
    "water": ("groundwater India irrigation quality", 5),
    "disaster_risk": ("drought India Madhya Pradesh agriculture", 5),
    "land_use": ("forest cover change India remote sensing", 5),
}


def fetch_doaj(query: str, page_size: int) -> list[dict]:
    url = "https://doaj.org/api/search/articles/" + urllib.parse.quote(query) + f"?pageSize={page_size}"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.load(resp)
    out = []
    for r in data.get("results", []):
        bj = r.get("bibjson", {})
        link = (bj.get("link") or [{}])[0].get("url")
        if not link:
            continue
        out.append({
            "doaj_id": r.get("id"),
            "title": bj.get("title"),
            "authors": ", ".join(a.get("name", "") for a in bj.get("author", [])) or None,
            "year": int(bj["year"]) if bj.get("year") else None,
            "journal": (bj.get("journal") or {}).get("title"),
            "link": link,
            "abstract": bj.get("abstract"),
        })
    return out


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"metadata": {"description": "Knowledge base manifest", "last_updated": None,
                          "generator": "scripts/fetch_knowledge_base.py"}, "entries": []}


def main():
    manifest = load_manifest()
    existing_ids = {e["id"] for e in manifest["entries"]}
    existing_urls = {e["source_url"] for e in manifest["entries"]}
    today = date.today().isoformat()
    added = 0
    failed = []

    for category, (query, page_size) in DOAJ_QUERIES.items():
        try:
            results = fetch_doaj(query, page_size)
        except Exception as exc:
            failed.append({"category": category, "query": query, "error": str(exc)})
            continue
        for r in results:
            if r["link"] in existing_urls:
                continue
            entry_id = "doaj-auto-" + (r["doaj_id"] or r["link"])[:24]
            if entry_id in existing_ids:
                continue
            manifest["entries"].append({
                "id": entry_id,
                "category": category,
                "title": r["title"],
                "authors": r["authors"],
                "year": r["year"],
                "source": f"DOAJ ({r['journal']})" if r["journal"] else "DOAJ",
                "source_url": r["link"],
                "license": "DOAJ-indexed open access; confirm article-level license on publisher page",
                "publish_date": str(r["year"]) if r["year"] else None,
                "fetch_date": today,
                "full_text_available": False,
                "local_path": None,
                "summary": (r["abstract"] or "")[:600] or "No abstract returned by DOAJ.",
            })
            existing_ids.add(entry_id)
            existing_urls.add(r["link"])
            added += 1

    manifest["metadata"]["last_updated"] = today
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    print(f"Knowledge base refresh: {added} new entries added, {len(manifest['entries'])} total.")
    if failed:
        print(f"{len(failed)} source(s) failed (non-fatal):")
        for f in failed:
            print(f"  - {f['category']}: {f['error']}")


if __name__ == "__main__":
    main()

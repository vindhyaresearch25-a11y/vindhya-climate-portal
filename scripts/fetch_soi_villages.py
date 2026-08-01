"""
fetch_soi_villages.py — manifest of village-boundary GeoJSON downloads from
the National Water Data Portal (NWDP, NWIC, Ministry of Jal Shakti).

https://nwdp.nwic.gov.in/dataset/village-boundary lists one KMZ + one
GeoJSON + one SHP resource per state/UT, all under filenames prefixed
`vb_soi_<state>` (village boundary, Survey of India). The portal's own
breadcrumb, however, tags this dataset's "Data Producer" as **Geological
Survey of India (GSI)**, not Survey of India (SoI) — the two are different
central agencies (GSI does geological/mineral mapping; SoI is India's
national topographic-mapping body, the agency that would normally produce
village cadastral/administrative boundaries). This script records the
producer exactly as the portal states it and does NOT assume the `soi`
filename prefix means Survey of India — that claim is unverified. See the
printed manifest summary and resolve this before writing any "authority"
metadata field that asserts Survey of India.

This script only builds the manifest (state name, resource id, download
URL). It does not download any state's data — see the repo owner's
instructions for the follow-up step that fetches Madhya Pradesh only.
"""
from __future__ import annotations

import html as html_module
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "outputs" / "soi_village_manifest.json"

DATASET_URL = "https://nwdp.nwic.gov.in/dataset/village-boundary"
TIMEOUT = 45

# Every Indian state/UT the portal is expected to cover (36). Used only to
# report what's missing after parsing — not injected into the manifest.
EXPECTED_STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh",
    "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman & Diu", "Delhi", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Jharkhand",
    "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
    "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
]

# Resource list items look like:
#   <li class="resource-item" data-id="<resource-id>">
#     <a class="heading" href="/dataset/village-boundary/resource/<id>"
#        title="Village Boundary of <State Name>">
#       Village Boundary of <State Name><span ... data-format="geojson">GEOJSON</span>
# Portal title casing is inconsistent ("Village Boundary of X" vs
# "village Boundary of X" for Uttarakhand) — match case-insensitively.
RESOURCE_ITEM_RE = re.compile(
    r'data-id="(?P<rid>[0-9a-f-]{36})".*?'
    r'title="[Vv]illage Boundary of (?P<state>[^"]+?)"[^>]*>.*?'
    r'data-format="(?P<fmt>[a-z0-9]+)"',
    re.DOTALL,
)

DOWNLOAD_HREF_RE = re.compile(
    r'href="(https://nwdp\.nwic\.gov\.in/dataset/[0-9a-f-]{36}/resource/'
    r'(?P<rid>[0-9a-f-]{36})/download/(?P<fname>vb_soi_[^"]+))"'
)

PRODUCER_RE = re.compile(
    r'<li><a href="/organization/[^"]+" title="([^"]+)">'
)


def fetch_page() -> str:
    req = urllib.request.Request(
        DATASET_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; vindhya-climate-portal/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8", errors="replace")


def parse_manifest(html: str) -> dict:
    # download-href map: resource id -> (filename, full url)
    downloads = {}
    for m in DOWNLOAD_HREF_RE.finditer(html):
        downloads[m.group("rid")] = {"filename": m.group("fname"), "url": m.group(1)}

    entries = []
    for m in RESOURCE_ITEM_RE.finditer(html):
        rid = m.group("rid")
        fmt = m.group("fmt").lower()
        if fmt != "geojson":
            continue
        dl = downloads.get(rid)
        if dl is None:
            continue
        entries.append({
            "state": html_module.unescape(m.group("state")).strip(),
            "resource_id": rid,
            "filename": dl["filename"],
            "download_url": dl["url"],
        })

    producer_match = PRODUCER_RE.search(html)
    producer = producer_match.group(1).strip() if producer_match else None

    return {"entries": entries, "producer_as_tagged_by_portal": producer}


def main() -> int:
    try:
        html = fetch_page()
    except Exception as exc:
        print(f"FETCH FAILED: {exc}", file=sys.stderr)
        return 1

    parsed = parse_manifest(html)
    entries = parsed["entries"]
    found_states = {e["state"] for e in entries}
    missing = [s for s in EXPECTED_STATES if s not in found_states]
    unexpected = sorted(found_states - set(EXPECTED_STATES))

    manifest = {
        "metadata": {
            "title": "Survey of India village boundary manifest (GeoJSON resources)",
            "source_page": DATASET_URL,
            "producer_as_tagged_by_portal": parsed["producer_as_tagged_by_portal"],
            "note": (
                "The portal breadcrumb tags this dataset's producer as shown "
                "above. Filenames use a 'vb_soi_' (village boundary, Survey "
                "of India) prefix, but that has NOT been independently "
                "confirmed to mean Survey of India is the actual surveying "
                "authority — do not assert 'Survey of India' as verified "
                "provenance without resolving this."
            ),
            "manifest_only": True,
            "downloaded": False,
        },
        "states": entries,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

    print(f"Producer tagged by portal: {parsed['producer_as_tagged_by_portal']!r}")
    print(f"GeoJSON resources found: {len(entries)} / {len(EXPECTED_STATES)} expected states")
    if missing:
        print(f"MISSING ({len(missing)}): {', '.join(missing)}")
    if unexpected:
        print(f"UNEXPECTED state names found ({len(unexpected)}): {', '.join(unexpected)}")
    print(f"Wrote {OUT}")
    return 0 if entries else 1


if __name__ == "__main__":
    raise SystemExit(main())

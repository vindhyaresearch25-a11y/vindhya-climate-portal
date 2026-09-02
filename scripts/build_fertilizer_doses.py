"""Build dashboard/data/fertilizer_doses.json from verified page citations."""
import json, datetime, pathlib

ROOT = pathlib.Path("/Users/science/Documents/vindhya-climate-portal/.claude/worktrees/agent-a88e0b07ce6f35d24")

SRC = {
    "title": "Crop Production Guide - Agriculture 2020",
    "publisher": "Directorate of Agriculture, Chepauk, Chennai 600 005 and Tamil Nadu Agricultural University, Coimbatore 641 003",
    "year": 2020,
    "url": "https://agritech.tnau.ac.in/pdf/AGRICULTURE.pdf",
    "short": "Crop Production Guide - Agriculture 2020, Directorate of Agriculture (Tamil Nadu) & TNAU",
    "applicability": (
        "Recommendations issued for TAMIL NADU. They are the state Directorate of "
        "Agriculture's and TNAU's own published blanket doses, not a national ICAR "
        "figure, and other states' agricultural universities publish their own "
        "package of practices with different numbers. Shown here as a real, citable "
        "reference point, explicitly labelled with the state it was issued for."
    ),
    "semantics": (
        "Every dose below is the guide's own 'blanket recommendation' - the value it "
        "instructs you to use ONLY WHEN A SOIL TEST IS NOT AVAILABLE. The guide's "
        "standing instruction in each of these sections is to apply fertiliser as per "
        "soil test recommendation wherever one exists. A soil test always overrides "
        "these numbers."
    ),
}

# (crop_key, label_en, label_hi, condition_en, condition_hi, N, P2O5, K2O, printed_page)
# Every row transcribed from the page cited; nothing interpolated or averaged.
ROWS = [
    ("rice", "Rice / Paddy", "धान",
     "Dry-seeded rainfed un-puddled lowland", "असिंचित (वर्षा आधारित) सूखी बुवाई, बिना कीचड़ वाली निचली भूमि",
     50, 25, 25, 34),
    ("rice", "Rice / Paddy", "धान",
     "Rainfed with supplemental irrigation", "वर्षा आधारित + पूरक सिंचाई",
     75, 25, 37.5, 36),
    ("rice", "Rice / Paddy", "धान",
     "Dry-seeded irrigated un-puddled lowland", "सिंचित सूखी बुवाई, बिना कीचड़ वाली निचली भूमि",
     75, 50, 37.5, 38),
    ("jowar", "Sorghum / Jowar", "ज्वार",
     "Transplanted crop", "रोपाई वाली फसल", 90, 45, 45, 68),
    ("jowar", "Sorghum / Jowar", "ज्वार",
     "Sown crop", "बुवाई वाली फसल", 90, 45, 45, 69),
    ("bajra", "Pearl millet / Bajra (Cumbu)", "बाजरा",
     "All varieties", "सभी किस्में", 70, 35, 35, 84),
    ("bajra", "Pearl millet / Bajra (Cumbu)", "बाजरा",
     "Hybrids", "संकर किस्में", 80, 40, 40, 84),
    ("ragi", "Finger millet / Ragi", "रागी",
     "General", "सामान्य", 60, 30, 30, 95),
    ("maize", "Maize", "मक्का",
     "Varieties", "किस्में", 135, 62.5, 50, 105),
    ("maize", "Maize", "मक्का",
     "Hybrid maize", "संकर मक्का", 250, 75, 75, 105),
    ("wheat", "Wheat", "गेहूँ",
     "General", "सामान्य", 80, 40, 40, 123),
    ("soyabean", "Soybean", "सोयाबीन",
     "When adequate moisture is available (plus 20 kg S/ha)",
     "पर्याप्त नमी होने पर (साथ में 20 kg गंधक/हेक्टेयर)", 20, 40, 20, 175),
    ("groundnut", "Groundnut", "मूँगफली",
     "Rainfed", "वर्षा आधारित", 10, 10, 45, 184),
    ("groundnut", "Groundnut", "मूँगफली",
     "Irrigated (plus 80 kg S as gypsum at 45 DAS)",
     "सिंचित (साथ में 45 दिन पर 80 kg गंधक, जिप्सम के रूप में)", 25, 50, 75, 187),
    ("sesamum", "Sesame / Til", "तिल",
     "Rainfed", "वर्षा आधारित", 23, 13, 13, 199),
    ("sesamum", "Sesame / Til", "तिल",
     "Irrigated", "सिंचित", 35, 23, 23, 199),
    ("sunflower", "Sunflower", "सूरजमुखी",
     "Hybrids, irrigated", "संकर, सिंचित", 60, 90, 60, 216),
    ("sunflower", "Sunflower", "सूरजमुखी",
     "Hybrids, rainfed", "संकर, वर्षा आधारित", 40, 50, 40, 216),
    ("sunflower", "Sunflower", "सूरजमुखी",
     "Varieties, irrigated", "किस्में, सिंचित", 60, 30, 30, 216),
    ("sunflower", "Sunflower", "सूरजमुखी",
     "Varieties, rainfed", "किस्में, वर्षा आधारित", 40, 50, 40, 216),
    ("cotton", "Cotton", "कपास",
     "Rice-fallow cotton", "धान के बाद की कपास", 60, 30, 30, 265),
    ("sugarcane", "Sugarcane", "गन्ना",
     "Plant crop, basal blanket recommendation", "पौध फसल, आधारीय संस्तुति",
     300, 100, 200, 289),
]

# DES / crop_list.json labels -> corpus crop_key. Only unambiguous mappings.
ALIASES = {
    "Rice": "rice", "Paddy": "rice",
    "Jowar": "jowar",
    "Bajra": "bajra",
    "Ragi": "ragi",
    "Maize": "maize",
    "Wheat": "wheat",
    "Soyabean": "soyabean",
    "Groundnut": "groundnut",
    "Sesamum": "sesamum",
    "Sunflower": "sunflower",
    "Cotton(lint)": "cotton",
    "Sugarcane": "sugarcane",
}

crops = {}
for key, en, hi, cond_en, cond_hi, n, p, k, page in ROWS:
    c = crops.setdefault(key, {"label_en": en, "label_hi": hi, "doses": []})
    c["doses"].append({
        "condition_en": cond_en,
        "condition_hi": cond_hi,
        "N_kg_per_ha": n,
        "P2O5_kg_per_ha": p,
        "K2O_kg_per_ha": k,
        "basis": "blanket recommendation (use only when no soil test is available)",
        "source_short": SRC["short"],
        "source_page_printed": page,
        "source_url": SRC["url"],
        "source_year": SRC["year"],
    })

payload = {
    "metadata": {
        "title": "Recommended fertiliser doses (N : P2O5 : K2O kg/ha), by crop and growing condition",
        "source": (SRC["title"] + " -- " + SRC["publisher"] + ". Transcribed from the "
                   "document's own 'blanket recommendation' statements, page by page; "
                   "each dose below carries the exact printed page it came from."),
        "source_url": SRC["url"],
        "resolution": ("Per crop and per stated growing condition (irrigated / rainfed / "
                       "variety / hybrid). NOT per district, NOT per field, and NOT a "
                       "soil-test-based prescription."),
        "CRS": "not applicable -- this is an agronomic reference table, not a geospatial layer",
        "processing": "scripts/build_fertilizer_doses.py",
        "last_updated": datetime.date.today().isoformat(),
        "applicability": SRC["applicability"],
        "semantics": SRC["semantics"],
        "season_assignment": (
            "This file deliberately does NOT assign crops to Kharif/Rabi/Zayad. The "
            "dashboard derives the season for a crop from the SELECTED DISTRICT'S OWN "
            "real DES records (dashboard/data/crop_stats_des_by_district/, which carry a "
            "published `season` field per crop-year), so the season shown is a real, "
            "district-specific, sourced fact rather than a national assumption typed in "
            "here. A crop the district has no DES record for is not placed in any season."
        ),
        "coverage_note": (
            "Only crops for which a blanket dose was actually located and transcribed are "
            "present. Crops absent from this file must be shown as 'not available', never "
            "filled from a neighbouring crop or an assumed value."
        ),
        "caution": (
            "A blanket dose is not agronomic advice for a specific field. Actual "
            "requirement varies with soil test values, variety, sowing date, irrigation "
            "and previous crop. Always prefer a Soil Health Card / soil test result and "
            "local KVK advice."
        ),
    },
    "aliases": ALIASES,
    "crops": crops,
}

out = ROOT / "dashboard" / "data" / "fertilizer_doses.json"
out.write_text(json.dumps(payload, indent=1, ensure_ascii=False))
print("wrote", out)
print("crops:", len(crops), "dose rows:", sum(len(c["doses"]) for c in crops.values()))

"""
12_ingest_kisan_manuals.py -- builds the Kisan Sahayak RAG corpus:
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
    python 12_ingest_kisan_manuals.py                       # ingest the whole CORPUS below
    python 12_ingest_kisan_manuals.py --dry-run              # fetch+extract+chunk, print counts, no embed/upsert (no Cloudflare creds needed)
    python 12_ingest_kisan_manuals.py --only wheat_pop_1984  # one document, by its `id` in CORPUS

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
import socket
import subprocess
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
    # wheat_pop_1984 (ICAR-IIWBR 1984 "Package of Practices for Increasing
    # Wheat Production") was REMOVED 2026-08-12 -- see
    # docs/KISAN_SAHAYAK_RAG.md for the full reasoning. Short version:
    # re-fetched and read in full; it explicitly recommends Aldrin (banned
    # in India since 2001/2002 under the Insecticides Act), BHC/HCH (banned
    # 1997), organomercurial seed-dressing fungicides Ceresan/Agrosan
    # (mercury compounds, banned), and Dimecron/phosphamidon (restricted for
    # most uses today) at specific dosages -- e.g. "Aldrin 5% @ 25 kg/ha".
    # A metadata caveat would not stop the model from surfacing a banned
    # chemical name+dosage as if it were current advice, so the document was
    # dropped from the corpus and its 16 vectors deleted from Vectorize
    # (`wrangler vectorize delete-vectors kisan-sahayak-manuals --ids
    # wheat_pop_1984__chunk0000 ... chunk0015`) rather than kept with a
    # warning attached.
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

    # -------------------------------------------------------------
    # Added 2026-08-12 (PENDING.md item 12, "CORPUS BADAO") -- 8 more real
    # documents, every URL fetched live and confirmed 200 OK / application/pdf
    # this session before being added here. See docs/KISAN_SAHAYAK_RAG.md for
    # the full per-crop coverage summary, what was tried and rejected (e.g.
    # cotton.dac.gov.in's official POP PDF is a scanned image with zero
    # extractable text; the 675-page CICR AICRP Cotton annual report is real
    # but is a research-trial report, not farmer advisory content, and would
    # have burned a large slice of the Vectorize free-tier dimension budget
    # on tables that don't answer farmer questions -- both excluded), and the
    # *.icar.gov.in DNS outage confirmed via public DNS (not environment-
    # specific) that ruled out krishi.icar.gov.in / kvk.icar.gov.in /
    # icar-nrri.in this session.
    # -------------------------------------------------------------
    {
        "id": "pau_pop_kharif_2026",
        "url": "https://pau.edu/content/ccil/pf/pp_kharif.pdf",
        "source": "Package of Practices for Crops of Punjab -- Kharif 2026 (Vol. 43, No. 1)",
        "crop": "multiple (kharif: paddy/rice, cotton, maize, soybean, sugarcane, kharif pulses, fodders)",
        "year": 2026,
        "publisher": "Punjab Agricultural University (PAU), Ludhiana",
    },
    {
        "id": "pau_pop_rabi_2025_26",
        "url": "https://pau.edu/content/ccil/pf/pp_rabi.pdf",
        "source": "Package of Practices for Crops of Punjab -- Rabi 2025-26 (Vol. 42, No. 2)",
        "crop": "multiple (rabi: wheat, gram/chana, mustard/raya, potato, sugarcane, rabi pulses, fodders)",
        "year": 2025,
        "publisher": "Punjab Agricultural University (PAU), Ludhiana",
    },
    {
        "id": "iiwbr_wheat_pocket_2023",
        "url": "https://iiwbr.org.in/wp-content/uploads/2023/08/EB-52-Wheat-Cultivation-in-India-Pocket-Guide.pdf",
        "source": "Wheat Cultivation in India -- Pocket Guide (Extension Bulletin 52)",
        "crop": "wheat",
        "year": 2023,
        "publisher": "ICAR-Indian Institute of Wheat and Barley Research (IIWBR)",
    },
    {
        "id": "iiwbr_wheat_conservation_agri_2024",
        "url": "https://iiwbr.org.in/wp-content/uploads/2024/01/RB-49-Conservation-Agriculture-for-Climate-Resilience-Sustainability-of-Wheat-based-Systems.pdf",
        "source": "Conservation Agriculture for Climate Resilience and Sustainability of Wheat based Systems (Research Bulletin 49)",
        "crop": "wheat",
        "year": 2024,
        "publisher": "ICAR-Indian Institute of Wheat and Barley Research (IIWBR)",
    },
    {
        "id": "iisr_soybean_extension_2023",
        "url": "https://icar-nsri.res.in/pdfdoc/ExtensionBulletin2023E_2.pdf",
        "source": "Improved Technologies and Technical Recommendations for Maximising Soybean Productivity in India (Extension Bulletin 18, 2023)",
        "crop": "soybean",
        "year": 2023,
        "publisher": "ICAR-Indian Institute of Soybean Research (IISR), Indore (currently hosted at icar-nsri.res.in)",
    },
    {
        "id": "iipr_chickpea_pc_report_2022",
        "url": "https://icar-iipr.org.in/wp-content/uploads/2023/07/PC-report-Chickpea_2021-22.pdf",
        "source": "ICAR-All India Coordinated Research Project on Chickpea -- Project Coordinator's Report (2021-22)",
        "crop": "chana/chickpea (gram)",
        "year": 2022,
        "publisher": "ICAR-Indian Institute of Pulses Research (IIPR), Kanpur",
    },
    {
        "id": "drmr_mustard_assam_bmp_2021",
        "url": "https://rmkpassam.in/pdf/bulletin_BMP.pdf",
        "source": "Best Management Practices of Rapeseed-Mustard Technologies for Assam",
        "crop": "sarson/mustard (rapeseed-mustard)",
        "year": 2021,
        "publisher": "ICAR-Directorate of Rapeseed-Mustard Research (DRMR), Bharatpur, via the Rapeseed-Mustard Knowledge Management Portal (rmkpassam.in), Assam",
    },
    {
        "id": "cotton_maharashtra_pop",
        "url": "https://static.vikaspedia.in/media/files_en/agriculture/crop-production/package-of-practices/practices-for-maharastra.pdf",
        "source": "Approved Package of Practices for Cotton: Maharashtra State",
        "crop": "cotton",
        "year": None,  # not stated in the document itself
        "publisher": "Maharashtra State Dept. of Agriculture POP, hosted on Vikaspedia (Govt. of India digital portal, MeitY/C-DAC) -- see docs/KISAN_SAHAYAK_RAG.md licensing note",
    },

    # -------------------------------------------------------------
    # Added 2026-08-13 (PENDING.md item 12 round 2, "CORPUS BADAO" -- all
    # remaining crops in dashboard/data/crop_list.json). Group 1: cereals/
    # millets not yet covered (maize, jowar, bajra, ragi, barley, small
    # millets). Every URL fetched live and confirmed 200 OK / application/pdf
    # this session. Two of these (iimr_finger_millet_pop,
    # iimr_small_millets_gap_2022) contain one isolated banned-pesticide
    # sentence each (Phosphamidon/Dimecron, Ceresan respectively) inside
    # otherwise clean, current documents -- kept in CORPUS because
    # chunk_pages()'s BANNED_CHEMICAL_TERMS filter (see above) drops exactly
    # those chunks at ingestion time, not the whole document. See
    # docs/KISAN_SAHAYAK_RAG.md for the full per-crop coverage summary.
    # -------------------------------------------------------------
    {
        "id": "dmr_maize_production_systems_2013",
        "url": "https://iimr.res.in/storage/publications/bulletins/Maize-production-system-book.pdf",
        "source": "Maize Production Systems for Improving Resource-Use Efficiency and Livelihood Security",
        "crop": "maize",
        "year": 2013,
        "publisher": "Directorate of Maize Research (DMR), New Delhi -- predecessor institute to ICAR-IIMR Ludhiana, hosted on iimr.res.in",
    },
    {
        "id": "iimr_sorghum_kharif_pop",
        "url": "https://www.millets.res.in/farmer/Recommended_package_of_Practices_Kharif.pdf",
        "source": "Recommended Package of Practices: Kharif Sorghum",
        "crop": "jowar",
        "year": None,
        "publisher": "ICAR-Indian Institute of Millets Research (IIMR), Rajendranagar, Hyderabad",
    },
    {
        "id": "iimr_sorghum_rabi_pop",
        "url": "https://www.millets.res.in/farmer/Recommended_packages_of_practices_Rabi_sorghum.pdf",
        "source": "Recommended Package of Practices: Rabi Sorghum",
        "crop": "jowar",
        "year": None,
        "publisher": "ICAR-Indian Institute of Millets Research (IIMR), Rajendranagar, Hyderabad",
    },
    {
        "id": "iimr_pearl_millet_pop",
        "url": "https://millets.res.in/technologies/Recommended_package_of_practices-Pearl_millet.pdf",
        "source": "Recommended Package of Practices: Pearl Millet",
        "crop": "bajra",
        "year": None,
        "publisher": "ICAR-Indian Institute of Millets Research (IIMR), Rajendranagar, Hyderabad",
    },
    {
        "id": "iimr_finger_millet_pop",
        "url": "https://www.millets.res.in/technologies/1-Recommended_Package_of_Practices-Finger_Millet.pdf",
        "source": "Recommended Package of Practices: Finger Millet (Eleusine coracana Gaertn.)",
        "crop": "ragi",
        "year": None,
        "publisher": "ICAR-Indian Institute of Millets Research (IIMR), Rajendranagar, Hyderabad",
    },
    {
        "id": "iiwbr_barley_eb53_pocket_guide",
        "url": "https://iiwbr.org.in/wp-content/uploads/2023/08/EB-53-Barley-Cultivation-in-India-Pocket-Guide.pdf",
        "source": "Barley Cultivation in India -- Pocket Guide (Extension Bulletin 53)",
        "crop": "barley",
        "year": None,  # cover doesn't state a year; internal text + pre-2014 imprint (Directorate of Wheat Research) suggests original ~2013-14, re-hosted 2023
        "publisher": "ICAR-Indian Institute of Wheat & Barley Research (IIWBR), Karnal",
    },
    {
        "id": "iimr_small_millets_gap_2022",
        "url": "https://www.millets.res.in/pub/2022/Good_Agronomic_Practices_2022.pdf",
        "source": "Good Agronomic Practices for Higher Yield in Small Millets (ISBN 978-93-94673-11-3)",
        "crop": "small millets",
        "year": 2022,
        "publisher": "ICAR-All India Coordinated Research Project on Small Millets / ICAR-Indian Institute of Millets Research, Hyderabad",
    },
    {
        "id": "iimr_kodo_millet_pop",
        "url": "https://www.millets.res.in/technologies/3-Recommended_Package_of_Practices-Kodo_Millet.pdf",
        "source": "Recommended Package of Practices: Kodo Millet (Paspalum scrobiculatum L.)",
        "crop": "small millets",
        "year": None,
        "publisher": "ICAR-Indian Institute of Millets Research (IIMR), Rajendranagar, Hyderabad",
    },

    # -------------------------------------------------------------
    # Added 2026-08-13 round 2, group 3: oilseeds not yet covered (groundnut,
    # sesamum, castor seed, sunflower, safflower, niger seed). Linseed is
    # NOT a new entry here -- it's already covered by the existing
    # pau_pop_rabi_2025_26 document above (same URL, pp.65-66 has a
    # dedicated LINSEED section not previously called out in that entry's
    # crop label; re-fetching it under a new id would just duplicate
    # already-ingested vectors). A 2005 ICAR-CRIDA linseed bulletin was
    # found and REJECTED -- explicit Aldrin/Chlordane, BHC, Ceresan
    # (organomercurial), Phosphamidon/Dimecron, Endosulfan, Monocrotophos
    # dosages throughout, same pervasive-not-isolated shape as the removed
    # wheat_pop_1984, so the whole document was excluded rather than relying
    # on the chunk-level filter for a document this saturated with banned
    # content.
    # -------------------------------------------------------------
    {
        "id": "dgr_groundnut_pop_states",
        "url": "https://icar-iigr.org.in/wp-content/uploads/2018/12/Package-of-Practices.pdf",
        "source": "Package of Practices (PoP's) of Groundnut for Different States",
        "crop": "groundnut",
        "year": None,  # not stated in document text; hosted in a 2018/12-dated upload folder
        "publisher": "ICAR-Directorate of Groundnut Research (DGR) / ICAR-Indian Institute of Groundnut Research (IIGR), Junagadh",
    },
    {
        "id": "tnau_cpg2020_oilseeds",
        "url": "https://tnau.ac.in/site/research/wp-content/uploads/sites/60/2020/02/Agriculture-CPG-2020.pdf",
        "source": "Crop Production Guide -- Agriculture 2020",
        "crop": "multiple (general TNAU crop production guide -- oilseeds sesamum/castor seed/sunflower/safflower/niger seed are the sections this entry was added for, but the 454-page document also covers rice, pulses, vegetables, fruits and other crops)",
        "year": 2020,
        "publisher": "Directorate of Agriculture, Govt. of Tamil Nadu & Tamil Nadu Agricultural University (TNAU), Coimbatore",
    },

    # -------------------------------------------------------------
    # Added 2026-08-13 round 2, batch 2: vegetables (potato, onion, tomato,
    # brinjal, bhindi, cabbage, cauliflower) and fruits (banana, mango,
    # citrus fruit, papaya, orange, pome fruit, other fresh fruits). Every
    # URL fetched live and confirmed 200 OK / application/pdf this session.
    # A 2003 TNAU/DPPQS papaya IPM bulletin was found and REJECTED --
    # recommends Endosulfan @ 1.25 l/ha (banned nationally, Supreme Court
    # order 2011); niphm_aesa_ipm_papaya_2015 covers papaya instead. An
    # ICAR-IIVR "Compendium on Pesticide Use in Vegetables" (2013) was found
    # but deliberately NOT added -- it's a regulatory/WHO-hazard-class/MRL
    # reference document, not farmer-facing cultivation advice, and its
    # banned/restricted-chemical mentions risk being chunked away from the
    # "banned" qualifier that makes them safe to read in context.
    # -------------------------------------------------------------
    {
        "id": "cpri_potato_gap_2020",
        "url": "https://icarcpri.res.in/WriteReadData/LINKS/GAP_Technical_Bulletin_108cf4149c3-240b-4452-9c1c-545d02c79e7f.pdf",
        "source": "Good Agricultural Practices (GAP) for Production of Potato Crop (Technical Bulletin No. 108)",
        "crop": "potato",
        "year": 2020,
        "publisher": "ICAR-Central Potato Research Institute (CPRI), Shimla",
    },
    {
        "id": "pau_vegetable_pop_2021",
        "url": "https://pau.edu/content/ccil/pf/pp_veg.pdf",
        "source": "Package of Practices for Cultivation of Vegetables",
        "crop": "multiple (onion, tomato, brinjal, bhindi, cabbage, cauliflower, potato)",
        "year": 2021,
        "publisher": "Punjab Agricultural University (PAU), Ludhiana",
    },
    {
        "id": "tnau_horticulture_cpg_2020",
        "url": "https://tnau.ac.in/site/research/wp-content/uploads/sites/60/2020/02/Horticulture-CPG-2020.pdf",
        "source": "Crop Production Guide -- Horticulture Crops 2020",
        "crop": "multiple (tomato, brinjal, bhindi, cabbage, cauliflower, onion, potato -- the 437-page document also covers other horticulture crops)",
        "year": 2020,
        "publisher": "Directorate of Horticulture and Plantation Crops, Govt. of Tamil Nadu & Tamil Nadu Agricultural University (TNAU), Coimbatore",
    },
    {
        "id": "niphm_aesa_ipm_banana_2014",
        "url": "https://niphm.gov.in/IPMPackages/Banana.pdf",
        "source": "AESA Based IPM Package -- Banana",
        "crop": "banana",
        "year": 2014,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad, jointly with Directorate of Plant Protection Quarantine & Storage (DPPQS), Govt. of India",
    },
    {
        "id": "niphm_aesa_ipm_mango_2014",
        "url": "https://niphm.gov.in/IPMPackages/Mango.pdf",
        "source": "AESA Based IPM Package -- Mango",
        "crop": "mango",
        "year": 2014,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad + DPPQS, Govt. of India",
    },
    {
        "id": "niphm_aesa_ipm_citrus_2014",
        "url": "https://niphm.gov.in/IPMPackages/Citrus.pdf",
        "source": "AESA Based IPM Package -- Citrus",
        "crop": "multiple (citrus fruit, orange -- explicit sweet orange/mandarin/kinnow and acid lime/lemon sub-sections)",
        "year": 2014,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad",
    },
    {
        "id": "niphm_aesa_ipm_papaya_2015",
        "url": "https://niphm.gov.in/IPMPackages/Papaya.pdf",
        "source": "AESA Based IPM Package -- Papaya",
        "crop": "papaya",
        "year": 2015,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad + DPPQS, Faridabad",
    },
    {
        "id": "niphm_aesa_ipm_apple_2014",
        "url": "https://niphm.gov.in/IPMPackages/Apple.pdf",
        "source": "AESA Based IPM Package -- Apple",
        "crop": "pome fruit",
        "year": 2014,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad",
    },
    {
        "id": "niphm_aesa_ipm_pear_2015",
        "url": "https://niphm.gov.in/IPMPackages/Pear.pdf",
        "source": "AESA Based IPM Package -- Pear",
        "crop": "pome fruit",
        "year": 2015,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad",
    },
    {
        "id": "niphm_aesa_ipm_guava_2015",
        "url": "https://niphm.gov.in/IPMPackages/Guava.pdf",
        "source": "AESA Based IPM Package -- Guava",
        "crop": "other fresh fruits",
        "year": 2015,
        "publisher": "National Institute of Plant Health Management (NIPHM), Hyderabad",
    },
    {
        "id": "kau_pop_crops_2016",
        "url": "https://kau.in/sites/default/files/documents/pop2016.pdf",
        "source": "Package of Practices Recommendations: Crops 2016 (15th edition)",
        "crop": "multiple (banana, mango, orange/mandarin, papaya, apple, guava, jack, indian gooseberry, pineapple, sapota, west indian cherry -- fruits chapter of a comprehensive multi-crop POP)",
        "year": 2016,
        "publisher": "Directorate of Extension, Kerala Agricultural University (KAU), Thrissur",
    },
    {
        "id": "hpshiva_subtropical_pop_2022",
        "url": "https://hpshiva.hp.gov.in/cms/media/4i4mx5ee/pop_final_06-10-2022.pdf",
        "source": "Package of Practices for Subtropical Fruit Crops of Himachal Pradesh",
        "crop": "multiple (mango, citrus fruit, orange, other fresh fruits (litchi, guava, pomegranate, plum, kiwifruit, persimmon, pecan nut))",
        "year": 2022,
        "publisher": "Dr. YS Parmar University of Horticulture & Forestry (COHF-Neri, Hamirpur), Dept. of Horticulture, Govt. of Himachal Pradesh, ADB-funded HPSHIVA project",
    },
    {
        "id": "ppqs_mango_export_pop_2022",
        "url": "https://ppqs.gov.in/sites/default/files/mango_pop_final_-08.12.2022.pdf",
        "source": "IPM Package of Practices for Mango (For Producing Quality Fruits for Export)",
        "crop": "mango",
        "year": 2022,
        "publisher": "Directorate of Plant Protection Quarantine & Storage (DPPQS), Ministry of Agriculture & Farmers' Welfare, Govt. of India, technically reviewed by ICAR-CISH Lucknow",
    },
    {
        "id": "nhm_ipm_schedule_banana_2012",
        "url": "https://agritech.tnau.ac.in/horticulture/pdf/tech_bulletin/national/IPM-Banana-Revised-Sept2011.pdf",
        "source": "Extension Bulletin No. 3 -- IPM Schedule for Banana Pests",
        "crop": "banana",
        "year": 2012,
        "publisher": "National Horticulture Mission, Ministry of Agriculture, Govt. of India, re-hosted on TNAU Agritech Portal",
    },
    {
        "id": "nrcb_tr4_banana_technote",
        "url": "https://nrcb.org.in/oldwebsite/documents/Publications/Tech%20Folder%20English/TF-tr4-eng.pdf",
        "source": "Technical Folder 1 -- Fusarium Wilt (Tropical Race 4), A Destructive Disease of Banana in India",
        "crop": "banana",
        "year": None,
        "publisher": "ICAR-National Research Centre for Banana (NRCB), Tiruchirappalli",
    },

    # -------------------------------------------------------------
    # Added 2026-08-13 round 2, batch 3: pulses (arhar/tur, moong, urad,
    # masoor, horse-gram, khesari, cowpea, peas & beans, other rabi/kharif
    # pulses). Every URL fetched live and confirmed 200 OK / application/pdf
    # this session. Primary source: Assam Agricultural University's KVK
    # Chirang/Kokrajhar per-crop Package-of-Practices chapters (kharif/rabi
    # 2021 and 2023 editions) -- a State Agricultural University source not
    # previously used in this corpus, chosen because AAU has published a
    # dedicated single-crop PDF for almost every pulse in this list, unlike
    # ICAR-IIPR whose per-crop bulletins found this session were image-only
    # (Urdbean, pigeonpea/greengram/blackgram pest field guides -- 0
    # extractable text, CorelDraw exports, not usable for text RAG).
    # -------------------------------------------------------------
    {
        "id": "aau_pigeonpea_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/kharif/Pigeonpea.pdf",
        "source": "Package of Practices for Kharif Crops of Assam, 2021 -- Pigeon Pea (Arhar)",
        "crop": "arhar/tur",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_greengram_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/kharif/Greengram.pdf",
        "source": "Package of Practices for Kharif Crops of Assam, 2021 -- Green Gram",
        "crop": "moong",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_blackgram_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/kharif/Blackgram.pdf",
        "source": "Package of Practices for Kharif Crops of Assam, 2021 -- Black Gram",
        "crop": "urad",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_lentil_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/Rabi/Lentil.pdf",
        "source": "Package of Practices for Rabi Crops of Assam, 2021 -- Lentil",
        "crop": "masoor",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "tnau_cpg2020_pulses",
        "url": "https://agritech.tnau.ac.in/pdf/AGRICULTURE.pdf",
        "source": "Crop Production Guide -- Agriculture 2020 (pulses chapter: redgram, blackgram, greengram, cowpea, horsegram)",
        "crop": "multiple (horse-gram primary target; also covers arhar/tur, urad, moong, cowpea)",
        "year": 2020,
        "publisher": "Directorate of Agriculture, Govt. of Tamil Nadu & Tamil Nadu Agricultural University, via agritech.tnau.ac.in",
    },
    {
        "id": "aau_grasspea_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/Rabi/Grasspea.pdf",
        "source": "Package of Practices for Rabi Crops of Assam, 2021 -- Grass Pea (Khesari)",
        "crop": "khesari",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_cowpea_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/kharif/Cowpea.pdf",
        "source": "Package of Practices for Kharif Crops of Assam, 2021 -- Cow Pea",
        "crop": "cowpea(lobia)",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_pea_pop_2021",
        "url": "https://kvkchirang.aau.ac.in/pdf/package_of_practice/Rabi/Pea.pdf",
        "source": "Package of Practices for Rabi Crops of Assam, 2021 -- Pea (Pisum sativum)",
        "crop": "peas & beans (pulses)",
        "year": 2021,
        "publisher": "Assam Agricultural University (Jorhat) & Directorate of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_kharif_pop_2023",
        "url": "https://kvkkokrajhar.aau.ac.in/PoP/PoP_(Kharif)_2023.pdf",
        "source": "Package of Practices for Kharif Crops of Assam, 2023 (full compilation)",
        "crop": "other kharif pulses (also has updated arhar/tur, moong, urad, cowpea chapters)",
        "year": 2023,
        "publisher": "Assam Agricultural University, Jorhat & Department of Agriculture, Govt. of Assam",
    },
    {
        "id": "aau_rabi_pop_2023",
        "url": "https://kvkkokrajhar.aau.ac.in/PoP/PoP_Rabi_2023.pdf",
        "source": "Package of Practices for Rabi Crops of Assam, 2023 (full compilation)",
        "crop": "other  Rabi pulses (also has updated masoor, khesari, peas & beans chapters)",
        "year": 2023,
        "publisher": "Assam Agricultural University, Jorhat & Department of Agriculture, Govt. of Assam",
    },

    # -------------------------------------------------------------
    # Added 2026-08-13 round 2, batch 4: fibre/plantation (sugarcane, jute,
    # tobacco, mesta, sannhamp) and spices (turmeric, dry chillies,
    # coriander, dry ginger). Garlic is NOT a new entry here -- already
    # covered by pau_vegetable_pop_2021 above (same URL, Chapter 21). Every
    # URL fetched live and confirmed 200 OK / application/pdf this session.
    # Environment note: most *.icar.gov.in institute subdomains return
    # DNS NXDOMAIN from this sandbox (confirmed real, not a proxy artifact --
    # bare icar.gov.in resolves fine); where an institute has a working
    # *.res.in sibling domain on the same server, that was used instead and
    # content-verified identical (CRIJAF, CTRI/NIRCA below).
    # -------------------------------------------------------------
    {
        "id": "sbi_tn_vksa_agrotech_2025",
        "url": "https://sugarcane.res.in/wp-content/uploads/2026/02/Book-2-VKA-Technology-Colour.pdf",
        "source": "Recent Agro-Technologies and Package of Practices for Important Crops of Tamil Nadu (VKSA-2025)",
        "crop": "sugarcane",
        "year": 2025,
        "publisher": "ICAR-Sugarcane Breeding Institute (SBI), Coimbatore",
    },
    {
        "id": "crijaf_jute_allied_fibres_cropcalendar_2013",
        "url": "http://crijaf.res.in/pdf/cropcalendar/JafCropCalendar_2013.pdf",
        "source": "Crop Calendar for Jute and Allied Fibres 2013",
        "crop": "multiple (jute, mesta, sannhamp -- also ramie and sisal)",
        "year": 2013,
        "publisher": "ICAR-Central Research Institute for Jute and Allied Fibres (CRIJAF), Barrackpore",
    },
    {
        "id": "ctri_nirca_fcv_agronomy",
        "url": "https://nirca.icar.gov.in/files/agronomy.pdf",
        "source": "Tobacco Production and Protection Technologies for Improving the Productivity & Quality (Agronomic Practices for FCV Tobacco in India)",
        "crop": "tobacco",
        "year": None,
        "publisher": "ICAR-Central Tobacco Research Institute (CTRI), Rajahmundry -- now ICAR-NIRCA (National Institute for Research on Commercial Agriculture)",
    },
    {
        "id": "iisr_turmeric_ext_pamphlet_2022",
        "url": "https://www.indianspices.com/sites/default/files/185.%20Institute%20Publication-Turmeric%20Extension%20Pamphlet%20-%20March%202022.pdf",
        "source": "Turmeric -- Extension Pamphlet",
        "crop": "turmeric",
        "year": 2022,
        "publisher": "ICAR-Indian Institute of Spices Research (IISR), Kozhikode, via indianspices.com (Spices Board of India)",
    },
    {
        "id": "iisr_chilli_gap_2019",
        "url": "https://www.indianspices.com/sites/default/files/cultivation_practices-Chillli-1.pdf",
        "source": "Chilli -- Good Agricultural Practices",
        "crop": "dry chillies",
        "year": 2019,
        "publisher": "ICAR-Indian Institute of Spices Research (IISR), Kozhikode, via indianspices.com (Spices Board of India)",
    },
    {
        "id": "iisr_coriander_gap_2019",
        "url": "https://www.indianspices.com/sites/default/files/cultivation_practices-Coriander-1.pdf",
        "source": "Coriander -- Good Agricultural Practices",
        "crop": "coriander",
        "year": 2019,
        "publisher": "ICAR-Indian Institute of Spices Research (IISR), Kozhikode, via indianspices.com (Spices Board of India)",
    },
    {
        "id": "iisr_ginger_ext_pamphlet_2025",
        "url": "https://spices.res.in/storage/app/public/pdfs/GINGER/3ENG.pdf",
        "source": "Ginger -- Extension Pamphlet",
        "crop": "dry ginger",
        "year": 2025,
        "publisher": "ICAR-Indian Institute of Spices Research (IISR), Kozhikode",
    },
]

FETCH_DATE = time.strftime("%Y-%m-%d")


def log(msg: str) -> None:
    print(f"[12_ingest_kisan_manuals] {msg}", file=sys.stderr)


def fetch_pdf_bytes(url: str) -> bytes | None:
    """Tries urllib first; falls back to the system `curl` binary if urllib
    fails with an SSL/TLS error. Confirmed 2026-08-12: this machine's system
    Python 3 links LibreSSL 2.8.3 (no TLS 1.3 support), and at least one real
    source (pau.edu, Punjab Agricultural University) requires TLS 1.3 and
    hard-rejects a TLS 1.2 ClientHello -- `curl` on the same machine
    negotiates TLS 1.3 fine (linked against a newer TLS stack), so this is a
    genuine local-interpreter limitation, not a reason to drop an otherwise
    real, fetchable source. The curl fallback still only returns bytes that
    were actually fetched over the network -- no synthetic content path."""
    req = urllib.request.Request(url, headers={"User-Agent": "VindhyaClimatePortal-KisanSahayak/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read()
    # NOTE (2026-08-12): on this machine's Python 3.9, socket.timeout is a
    # DISTINCT class from TimeoutError (they were only unified as aliases in
    # 3.10) -- the original except clause here didn't catch it, so a single
    # slow/unresponsive server (icar.org.in, observed live) crashed the
    # entire multi-document ingestion run instead of being logged as one
    # document's failure. socket.timeout is also a subclass of OSError, so
    # catching OSError alongside URLError/HTTPError covers this and any
    # similar low-level network exception without enumerating every one.
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, socket.timeout, OSError) as e:
        log(f"urllib FAILED fetching {url}: {e} -- trying curl fallback")
        try:
            result = subprocess.run(
                ["curl", "-sS", "-L", "--max-time", str(TIMEOUT), "-A", "VindhyaClimatePortal-KisanSahayak/1.0", url],
                capture_output=True, timeout=TIMEOUT + 5, check=False,
            )
            if result.returncode == 0 and result.stdout:
                return result.stdout
            log(f"curl fallback ALSO FAILED for {url}: exit {result.returncode}, stderr={result.stderr[:300]!r}")
            return None
        except Exception as e2:
            log(f"curl fallback FAILED for {url}: {e2}")
            return None


_REPEATED_CHAR_RUN_RE = re.compile(r"(.)\1{4,}")


def _looks_5x_duplicated(text: str) -> bool:
    """Detects a specific real pdfplumber extraction artifact (found
    2026-08-12, organic_pop_maharashtra): some PDFs render each glyph via
    multiple overlapping paths (a faux-bold/emboss effect from whatever
    tool generated the PDF), and pdfplumber's extract_text() picks up
    every overlapping instance, turning "Package" into
    "PPPPPaaaaaccccckkkkkaaaaagggggeeeee" (every character repeated
    exactly 5x, consistently, across the whole page). Detected by sampling
    how much of the text is covered by runs of 5+ identical characters --
    genuine prose essentially never has this property at scale (a real
    "aaaaa" or "00000" run is rare and short), so a high coverage ratio is
    a reliable, specific signal rather than a guess."""
    if len(text) < 20:
        return False
    covered = sum(len(m.group(0)) for m in _REPEATED_CHAR_RUN_RE.finditer(text))
    return covered / len(text) > 0.5


def _fix_5x_duplicated(text: str) -> str:
    """Collapses every run of 5+ identical characters to 1 -- only called
    after _looks_5x_duplicated() confirms this specific corruption pattern
    for the page, so it never touches normal text elsewhere. Real content
    recovered, not fabricated: same characters the PDF actually contains,
    just de-duplicated back to their intended single occurrence."""
    return re.sub(r"(.)\1{4,}", r"\1", text)


def extract_pages(pdf_bytes: bytes) -> list[str]:
    """Returns a list of page texts (1-indexed by position). Never
    fabricates text for a page that fails to extract -- an empty/failed
    page is an empty string, dropped later, not padded."""
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is not installed -- `pip install pdfplumber` (now in requirements.txt)")
    pages = []
    n_fixed = 0
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            try:
                text = page.extract_text() or ""
            except Exception as e:
                log(f"  page extract failed: {e}")
                text = ""
            if text and _looks_5x_duplicated(text):
                text = _fix_5x_duplicated(text)
                n_fixed += 1
            pages.append(text)
    if n_fixed:
        log(f"  repaired {n_fixed}/{len(pages)} page(s) with the 5x-character-duplication extraction artifact")
    return pages


# Banned-chemical chunk filter (added 2026-08-13, PENDING.md item 12 round 2):
# same reasoning docs/KISAN_SAHAYAK_RAG.md already recorded for the wheat_pop_1984
# removal (Aldrin, BHC/HCH, organomercurial Ceresan/Agrosan, Dimecron/phosphamidon --
# a metadata caveat doesn't stop a model from surfacing a banned chemical name+dosage
# as if it were current advice), but applied at CHUNK granularity instead of whole-
# document. Round 1 dropped wheat_pop_1984 entirely because banned-pesticide
# recommendations ran through the whole 1984 document's plant-protection philosophy.
# Round 2 found the opposite shape twice (ICAR-IIMR finger millet POP recommending
# Phosphamidon for stem borer; the ICAR small millets 2022 book recommending Ceresan
# seed treatment for foxtail millet): one isolated banned-chemical sentence inside an
# otherwise clean, current, useful document. Dropping the whole document over one
# sentence would throw away real good content for no safety benefit -- so instead
# this filter drops only the specific chunk(s) that mention a banned chemical,
# applied globally so it protects every future document too, not just these two.
BANNED_CHEMICAL_TERMS = [
    "aldrin", "dieldrin", "endrin",
    "bhc", "hch", "hexachlorocyclohexane", "lindane",
    "ceresan", "agrosan",  # organomercurial (mercury) seed-dressing fungicides
    "dimecron", "phosphamidon",
    "ddt",
    "heptachlor", "chlordane",
    # Widened 2026-08-13 round 2 batch 2 (vegetables/fruits) -- these kept
    # surfacing across multiple new ICAR/SAU documents' own "banned/
    # restricted pesticide" reference appendices and, in at least one
    # rejected document (a 2003 TNAU/DPPQS papaya IPM bulletin), as an
    # actual dosage recommendation. Endosulfan: banned nationally by
    # Supreme Court order, 2011. Monocrotophos: banned by CIB&RC for use on
    # vegetable crops specifically (2013) -- this corpus is majority
    # vegetable/fruit crops, so treated as filterable here. The mercury/
    # cyanide/organochlorine compounds below are all on CIB&RC's banned list.
    "endosulfan", "monocrotophos",
    "methyl parathion", "ethyl parathion",
    "calcium cyanide", "sodium cyanide",
    "nicotine sulphate", "nicotine sulfate",
    "toxaphene", "pentachlorophenol", "pentachloronitrobenzene", "nitrofen",
    "menazon", "sodium methane arsonate", "copper acetoarsenite",
    "chlorofenvinphos", "phenyl mercury acetate", "ethyl mercury chloride",
]
_BANNED_CHEMICAL_RE = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in BANNED_CHEMICAL_TERMS) + r")\b", re.IGNORECASE
)


def _contains_banned_chemical(text: str) -> str | None:
    """Returns the matched term if text mentions a chemical banned in India
    (Insecticides Act / CIB&RC), else None. Word-boundary regex so it won't
    false-positive on unrelated substrings."""
    m = _BANNED_CHEMICAL_RE.search(text)
    return m.group(1) if m else None


def chunk_pages(pages: list[str], doc: dict) -> list[dict]:
    """Chunks by ~CHUNK_WORDS words with CHUNK_OVERLAP_WORDS overlap,
    tracking which page(s) each chunk actually came from -- this is what
    lets search_manuals cite a real page number, never a guessed one.
    Drops (does not merely flag) any chunk mentioning a banned pesticide/
    fungicide -- see BANNED_CHEMICAL_TERMS note above."""
    chunks = []
    n_dropped_banned = 0
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
    doc_chunk_idx = 0  # per-DOCUMENT chunk counter -- see make_chunk_id note on
    # why this must never be a position within the whole multi-document run.
    while i < len(stream):
        window = stream[i:i + CHUNK_WORDS]
        if not window:
            break
        words = [w for w, _ in window]
        page_nos = sorted(set(p for _, p in window))
        text = " ".join(words).strip()
        if len(text) >= 40:  # drop near-empty chunks (e.g. a mostly-blank page)
            banned = _contains_banned_chemical(text)
            if banned:
                n_dropped_banned += 1
                log(f"  DROPPED chunk (pages {page_nos[0]}-{page_nos[-1]}) -- mentions banned chemical '{banned}'")
                i += step
                continue
            chunks.append({
                "text": text,
                "page_start": page_nos[0],
                "page_end": page_nos[-1],
                "doc_chunk_idx": doc_chunk_idx,
                **{k: doc[k] for k in ("id", "source", "crop", "year", "publisher", "url")},
            })
            doc_chunk_idx += 1
        i += step
    if n_dropped_banned:
        log(f"  {n_dropped_banned} chunk(s) dropped for banned-chemical content in {doc['id']}")
    return chunks


def cf_api(path: str, method: str = "GET", body: bytes | None = None, content_type: str = "application/json"):
    """2026-08-13: this run hit Workers AI's free-tier rate limit twice in a
    row, both times right at the start of a large (3118-chunk) embedding
    batch -- a real, reproducible transient limit, not a one-off network
    blip. Retries on HTTP 429 with exponential backoff (5 attempts, 10s base)
    rather than requiring the whole multi-hundred-chunk run to be manually
    re-invoked from scratch on every rate-limit hit. Any other HTTP error is
    still raised immediately -- only 429 is treated as retryable, per this
    repo's "seemaa paas aaye to RUKO" rule: if it's STILL 429 after 5 real
    backed-off attempts, that's a genuine ceiling worth stopping and
    reporting on, not silently working around forever."""
    if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
        raise RuntimeError("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set")
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}{path}"
    max_attempts = 5
    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(url, data=body, method=method, headers={
            "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
            "Content-Type": content_type,
        })
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_attempts:
                wait_s = 10 * (2 ** (attempt - 1))  # 10, 20, 40, 80s
                log(f"  429 rate limited on {path} (attempt {attempt}/{max_attempts}) -- waiting {wait_s}s")
                time.sleep(wait_s)
                continue
            raise


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
    """idx MUST be the chunk's position within its OWN document
    (chunk_pages()'s doc_chunk_idx), never a position within the whole
    multi-document run. Bug found and fixed 2026-08-12: the embed loop used
    to pass batch_start+local_idx -- a position across the entire all_chunks
    list spanning every document in that run -- so adding/removing/reordering
    ANY document in CORPUS silently reassigned every later document's ids on
    the next run, orphaning the old ids as duplicate/stale vectors in
    Vectorize instead of upserting over them in place. See
    docs/KISAN_SAHAYAK_RAG.md for why the existing index was wiped and
    rebuilt from scratch once, rather than trying to reconcile old
    global-index ids with the corrected per-document ones."""
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

    # Embed AND upsert each batch immediately, rather than embedding
    # everything first and upserting at the very end -- 2026-08-13: a
    # 3118-chunk run hit Workers AI's rate limit partway through embedding
    # twice; with the old embed-everything-then-upsert-everything structure
    # that meant losing ALL progress on every failure, even chunks already
    # successfully embedded. Now each 20-chunk batch is durable the moment
    # it's embedded -- a later failure only costs the remaining un-embedded
    # batches, and re-running the script is a real (if wasteful) resume,
    # not a from-scratch redo (Vectorize upsert is idempotent by id).
    log(f"embedding+upserting {len(all_chunks)} chunks via {EMBEDDING_MODEL} (batches of {EMBED_BATCH_SIZE})...")
    total_upserted = 0
    for batch_start in range(0, len(all_chunks), EMBED_BATCH_SIZE):
        batch = all_chunks[batch_start:batch_start + EMBED_BATCH_SIZE]
        vectors = embed_batch([c["text"] for c in batch])
        records = []
        for chunk, vector in zip(batch, vectors):
            records.append({
                "id": make_chunk_id(chunk["id"], chunk["doc_chunk_idx"]),
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
        upsert_batch(records)
        total_upserted += len(records)
        log(f"  embedded+upserted {min(batch_start + EMBED_BATCH_SIZE, len(all_chunks))}/{len(all_chunks)}")

    log(f"done. {total_upserted} vectors upserted to '{VECTORIZE_INDEX_NAME}'.")


if __name__ == "__main__":
    main()

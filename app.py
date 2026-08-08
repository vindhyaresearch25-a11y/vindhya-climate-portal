"""
Streamlit app for MP Climate Intelligence Dashboard.

Strategy:  Use st.components.v1.html() with an iframe.  JS files are inlined
into the HTML so that data URL patches are applied to the fetch calls.
All data files are fetched from GitHub raw CDN at runtime.
"""
import streamlit as st
import os

st.set_page_config(page_title="MP Climate Intelligence", layout="wide", page_icon="\U0001f33e")

DASHBOARD_DIR = os.path.join(os.path.dirname(__file__), 'dashboard')
GITHUB_RAW = "https://raw.githubusercontent.com/vindhyaresearch25-a11y/vindhyaclimate/main/dashboard/data"
GITHUB_BASE = "https://raw.githubusercontent.com/vindhyaresearch25-a11y/vindhyaclimate/main/dashboard"

_URL_PATCHES = [
    ("'data/mp_climate_data.json'",        f"'{GITHUB_RAW}/mp_climate_data.json'"),
    ("'data/dicra_ndvi.json'",             f"'{GITHUB_RAW}/dicra_ndvi.json'"),
    ("'data/forecast_2040.json'",          f"'{GITHUB_RAW}/forecast_2040.json'"),
    ("'data/knowledge_base/index.json'",   f"'{GITHUB_RAW}/knowledge_base/index.json'"),
    ("'data/mandi_prices.json'",           f"'{GITHUB_RAW}/mandi_prices.json'"),
    ("'data/crop_stats.json'",             f"'{GITHUB_RAW}/crop_stats.json'"),
    # Boundary GeoJSON files (in dashboard/ root, not dashboard/data/)
    ("'mp_districts.geojson'",             f"'{GITHUB_BASE}/mp_districts.geojson'"),
    ("'mp_tehsils.geojson'",               f"'{GITHUB_BASE}/mp_tehsils.geojson'"),
    ("'mp_blocks.geojson'",                f"'{GITHUB_BASE}/mp_blocks.geojson'"),
]

# geoai_professional.js and mandi_loader.js were previously missing from this
# list, so neither module loaded at all on the Streamlit deployment (only on
# GitHub Pages, which serves the scripts directly). See docs/AUDIT_2026-08-01.md J.
# national_climate_loader.js and compare_loader.js are the same class of
# bug as the geoai/mandi one above -- added 2026-08-07 alongside Phase 6.
_JS_FILES = ['mp_climate_loader.js', 'dicra_ndvi_loader.js', 'cadastral_loader.js',
             'geoai_professional.js', 'mandi_loader.js', 'crop_stats_loader.js', 'live_weather_loader.js',
             'national_climate_loader.js', 'compare_loader.js', 'research_papers_loader.js',
             'knowledge_base_loader.js',
             'national_selector.js']


def get_html_content():
    with open(os.path.join(DASHBOARD_DIR, 'index.html'), 'r', encoding='utf-8') as f:
        html = f.read()

    # Inline external JS files so that fetch URLs inside them get patched
    for js_file in _JS_FILES:
        js_path = os.path.join(DASHBOARD_DIR, js_file)
        with open(js_path, 'r', encoding='utf-8') as f:
            js_content = f.read()

        old_tag = f'<script src="{js_file}"></script>'
        new_tag = f'<script>{js_content}</script>'
        html = html.replace(old_tag, new_tag)

    # Apply URL patches (now hits fetch URLs inside inlined JS)
    for old, new in _URL_PATCHES:
        html = html.replace(old, new)

    # Also patch dynamic URL patterns built via string concatenation, which
    # the literal-string _URL_PATCHES loop above can't catch (e.g.
    # 'data/boundaries/' + 'soi/states.geojson' /
    # 'data/boundaries/' + 'soi/blocks/' + stateSlug + '.geojson' /
    # 'data/boundaries/' + 'soi/villages/' + stateSlug + '/' + districtSlug + '.geojson'
    # in national_selector.js, or
    # 'data/boundaries/' + 'soi/villages/madhya_pradesh/' + slug + '.geojson'
    # in index.html's loadVillageBoundaries()).
    # Matches only the exact closed string literal 'data/boundaries/' --
    # any fetch URL built from this prefix must keep it as its own
    # concatenated literal rather than folding it into one longer literal,
    # or it won't be rewritten here and will 404 on this deployment.
    html = html.replace(
        "'data/boundaries/'",
        f"'{GITHUB_RAW}/boundaries/'"
    )

    # Same concatenation-prefix pattern as boundaries/ above, for
    # crop_stats_loader.js's per-district DES fetch
    # ('data/crop_stats_des_by_district/' + stateSlug + '/' + districtSlug + '.json').
    html = html.replace(
        "'data/crop_stats_des_by_district/'",
        f"'{GITHUB_RAW}/crop_stats_des_by_district/'"
    )

    # Same pattern for the GEE national climate files
    # ('data/climate/' + stateSlug + '/' + districtSlug + '.json'), used by
    # national_climate_loader.js and compare_loader.js. These live in the
    # git repo (not the Hugging Face village_profiles/boundaries dataset),
    # so they're served from the same GITHUB_RAW dashboard/data CDN path.
    html = html.replace(
        "'data/climate/'",
        f"'{GITHUB_RAW}/climate/'"
    )

    # Fix viewport for iframe rendering
    html = html.replace(
        'html,body{height:100%;overflow:hidden;}',
        'html,body{height:100%;width:100%;overflow:hidden;margin:0;padding:0;}'
    )
    html = html.replace(
        '#hero{position:relative;min-height:100%',
        '#hero{position:relative;min-height:100vh'
    )

    # Inject Gemini API key from Streamlit Secrets (fallback to hardcoded)
    gemini_key = st.secrets.get("GEMINI_API_KEY", "")  # never hardcode keys
    html = html.replace(
        "const GEMINI_KEY = ''; // injected at deploy time via Streamlit secrets",
        f"const GEMINI_KEY = '{gemini_key}';"
    )

    # Handle logo for Streamlit (convert to base64 if file exists locally)
    logo_path = os.path.join(DASHBOARD_DIR, 'logo.jpeg')
    if os.path.exists(logo_path):
        import base64
        with open(logo_path, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode()
        html = html.replace(
            'logo.jpeg',
            f'data:image/jpeg;base64,{b64}'
        )

    return html


def main():
    # Hide Streamlit chrome and force iframe to fill viewport
    st.markdown("""
        <style>
        .stApp, .stApp > div, .block-container {
            margin: 0 !important; padding: 0 !important;
            max-width: 100% !important; width: 100% !important;
        }
        #main-menu, header, footer { display: none !important; }
        .appview-container, .main, .stApp {
            position: fixed; top: 0; left: 0;
            width: 100vw !important; height: 100vh !important;
            overflow: hidden !important;
        }
        iframe {
            width: 100vw !important;
            height: 100vh !important;
            border: none !important;
        }
        .stHtml {
            width: 100% !important;
            height: 100vh !important;
        }
        section[data-testid="stBottom"] { display: none !important; }
        </style>
    """, unsafe_allow_html=True)

    html = get_html_content()
    st.components.v1.html(html, height=10000, scrolling=False)


if __name__ == '__main__':
    main()

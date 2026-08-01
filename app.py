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
    # Boundary GeoJSON files (in dashboard/ root, not dashboard/data/)
    ("'mp_districts.geojson'",             f"'{GITHUB_BASE}/mp_districts.geojson'"),
    ("'data/boundaries/india_states.geojson'",    f"'{GITHUB_RAW}/boundaries/india_states.geojson'"),
    ("'data/boundaries/india_districts.geojson'", f"'{GITHUB_RAW}/boundaries/india_districts.geojson'"),
    ("'mp_tehsils.geojson'",               f"'{GITHUB_BASE}/mp_tehsils.geojson'"),
    ("'mp_blocks.geojson'",                f"'{GITHUB_BASE}/mp_blocks.geojson'"),
]

_JS_FILES = ['mp_climate_loader.js', 'dicra_ndvi_loader.js', 'cadastral_loader.js', 'india_boundaries_loader.js', 'knowledge_base_loader.js']


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
        if old in html:
            html = html.replace(old, new)
        else:
            # Dynamic village URL: 'data/villages_'+distKey+'.geojson'
            pass  # handled by replace below

    # Also patch the dynamic village URL pattern
    html = html.replace(
        "'data/villages_'",
        f"'{GITHUB_RAW}/villages_'"
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

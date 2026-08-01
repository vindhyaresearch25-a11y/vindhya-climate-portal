"""
config.py — MP Climate Intelligence pipeline (5 major districts).
"""
import os
from pathlib import Path

# ---------- INPUT DATA PATHS ----------
# Set via environment variables (see .env.example). Defaults assume ./data.
_ROOT = Path(__file__).resolve().parent.parent
TMAX_DIR   = Path(os.environ.get("IMD_TMAX_DIR",   _ROOT / "data" / "imd" / "tmax"))
TMIN_DIR   = Path(os.environ.get("IMD_TMIN_DIR",   _ROOT / "data" / "imd" / "tmin"))
PRECIP_DIR = Path(os.environ.get("IMD_PRECIP_DIR", _ROOT / "data" / "imd" / "precip"))

TMAX_FILE_PATTERN   = "INDmet_tmax_05km_{year}.nc"
TMIN_FILE_PATTERN   = "INDmet_tmin_05km_{year}.nc"
PRECIP_FILE_PATTERN = "INDmet_precipitation_05km_{year}.nc"

MP_SHAPEFILE = Path(os.environ.get("MP_VILLAGE_SHAPEFILE", _ROOT / "data" / "boundaries" / "MADHYA_PRADESH.shp"))

YEAR_START = 2000
YEAR_END   = 2024

# ---------- TARGET DISTRICTS (centroids from the dashboard HTML) ----------
# key, display name, lat, lng — these MUST match the keys in MP_DISTRICTS in U.html
DISTRICTS = {
    "bhopal":   {"name": "Bhopal",   "lat": 23.2600, "lng": 77.4130},
    "indore":   {"name": "Indore",   "lat": 22.7196, "lng": 75.8577},
    "jabalpur": {"name": "Jabalpur", "lat": 23.1810, "lng": 79.9860},
    "rewa":     {"name": "Rewa",     "lat": 24.5310, "lng": 81.2970},
    "sidhi":    {"name": "Sidhi",    "lat": 24.4180, "lng": 81.8810},
}

# Spatial sample radius around the centroid (degrees). 0.1 deg ~ 11 km ~ 5x5 pixels.
SAMPLE_HALF_BOX_DEG = 0.10

# ---------- OUTPUT PATHS ----------
PROJECT_ROOT       = Path(__file__).resolve().parent.parent
OUTPUT_DIR         = PROJECT_ROOT / "outputs"
CACHE_DIR          = OUTPUT_DIR / "cache"
DASHBOARD_DATA_DIR = PROJECT_ROOT / "dashboard" / "data"
for d in (OUTPUT_DIR, CACHE_DIR, DASHBOARD_DATA_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ---------- NETCDF AUTO-DETECT ----------
TMAX_VAR_CANDIDATES   = ["tmax", "TMAX", "temperature", "max_temp", "t_max", "Tmax"]
TMIN_VAR_CANDIDATES   = ["tmin", "TMIN", "min_temp", "t_min", "Tmin"]
PRECIP_VAR_CANDIDATES = ["rain", "rainfall", "precip", "precipitation", "PRECIP", "RAIN", "RAINFALL"]
LAT_CANDIDATES        = ["lat", "latitude", "LATITUDE", "y", "LAT"]
LON_CANDIDATES        = ["lon", "longitude", "LONGITUDE", "x", "LON"]
TIME_CANDIDATES       = ["time", "TIME", "t"]

# ---------- HEATWAVE THRESHOLDS (IMD, plains) ----------
HW_TMAX_ABS_THRESHOLD = 40.0
HW_TMAX_SEVERE        = 45.0
HW_DEPARTURE_MILD     = 4.5
HW_DEPARTURE_SEVERE   = 6.5
HW_MIN_CONSEC_DAYS    = 2
HW_SEASON_MONTHS      = (3, 4, 5, 6)

# ---------- DROUGHT (SPI) ----------
SPI_TIMESCALES        = [3, 6, 12]
DROUGHT_SPI_THRESHOLD = -1.0          # moderate drought
SEVERE_DROUGHT_SPI    = -1.5

# ---------- EXTREME PRECIP (ETCCDI) ----------
EXT_PRECIP_PERCENTILES = [95, 99]
WET_DAY_THRESHOLD_MM   = 1.0
# Fixed base period for percentile thresholds (ETCCDI requires a stable
# reference period; with a 2000-2024 record we use the first 15 years).
EXT_PRECIP_BASE_PERIOD = (2000, 2014)

# ---------- SPATIAL SAMPLING ----------
# "centroid"  : nearest IMD pixel at village centroid (fast; adequate when
#               the village is smaller than one 5.5 km pixel).
# "polygon"   : area-weighted mean of all pixels intersecting the village
#               polygon (preferred for large villages and for districts;
#               requires geopandas + the village shapefile).
VILLAGE_SAMPLE_METHOD = "centroid"

# ---------- GEE CMIP6 ----------
GEE_PROJECT_ID     = os.environ.get("GEE_PROJECT_ID", "")
FUTURE_TARGET_YEAR = 2040
FUTURE_WINDOW      = (2036, 2045)
HISTORICAL_BASELINE_WINDOW = (2000, 2014)
CMIP6_MODELS = [
    "ACCESS-CM2", "CMCC-ESM2", "EC-Earth3", "GFDL-ESM4",
    "INM-CM5-0", "MPI-ESM1-2-HR", "MRI-ESM2-0", "NorESM2-MM",
]
CMIP6_SCENARIO = "ssp245"

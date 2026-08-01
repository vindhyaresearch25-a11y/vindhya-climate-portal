import json, os, glob, re
import numpy as np

BASE = os.environ.get('DICRA_DIR', os.path.join(os.path.dirname(__file__), '..', 'data', 'dicra'))
OUT_NDVI = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'data', 'dicra_ndvi.json')
OUT_FORECAST = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'data', 'forecast_2040.json')

# ── 1. Extract DICRA NDVI time series ──────────────────────────
ndvi_by_district = {}
total_files = 0

years_dirs = sorted([
    d for d in os.listdir(BASE)
    if d.startswith('NDVI_') and os.path.isdir(os.path.join(BASE, d))
])

for yd in years_dirs:
    parts = yd.split('_')
    year_label = parts[1]
    half = parts[2] if len(parts) > 2 else '?'
    for subdir in ['VECTOR\\DISTRICT', 'VECTOR\\DISTRICT', '']:
        path = os.path.join(BASE, yd, subdir)
        if os.path.isdir(path):
            break
    else:
        continue
    files = sorted([f for f in os.listdir(path) if f.endswith('.geojson') and os.path.isfile(os.path.join(path, f))])
    total_files += len(files)
    for fname in files:
        date_str = fname.replace('.geojson', '')
        parts_date = date_str.split('-')
        if len(parts_date) != 3:
            continue
        day, month, year_f = parts_date
        date_key = f'{year_f}-{month}-{day}'
        try:
            with open(os.path.join(path, fname), 'r', encoding='utf-8') as f:
                gj = json.load(f)
        except:
            continue
        for feat in gj.get('features', []):
            props = feat.get('properties', {})
            dname = props.get('district_name', '').strip()
            if not dname:
                continue
            zs = props.get('zonalstat', {})
            if dname not in ndvi_by_district:
                ndvi_by_district[dname] = {}
            if date_key not in ndvi_by_district[dname]:
                ndvi_by_district[dname][date_key] = {
                    'ndvi_mean': round(zs.get('mean', 0) or 0, 4),
                    'ndvi_min': round(zs.get('min', 0) or 0, 4),
                    'ndvi_max': round(zs.get('max', 0) or 0, 4),
                }

print(f'Processed {total_files} files across {len(years_dirs)} year directories')
print(f'Districts with NDVI: {len(ndvi_by_district)}')
total_records = sum(len(v) for v in ndvi_by_district.values())
print(f'Total NDVI records: {total_records}')

# ── 2. Load existing climate data to add forecasts ─────────────
climate_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'data', 'mp_climate_data.json')
with open(climate_path, 'r', encoding='utf-8') as f:
    climate_data = json.load(f)

# ── 3. AI Forecast: linear regression on annual trends ─────────
def simple_linear_regression(x, y):
    n = len(x)
    if n < 3:
        return None
    x_mean = np.mean(x)
    y_mean = np.mean(y)
    num = np.sum((x - x_mean) * (y - y_mean))
    den = np.sum((x - x_mean) ** 2)
    if den == 0:
        return None
    slope = num / den
    intercept = y_mean - slope * x_mean
    return slope, intercept

forecast_data = {'districts': {}}

for dk, dist in climate_data['districts'].items():
    ann = dist.get('annual')
    if not ann or not ann.get('years'):
        continue
    years = np.array(ann['years'])
    future_years = list(range(2025, 2041))
    fdict = {'years': future_years}

    for metric in ['heatwave_days', 'annual_rain_mm', 'rx1day_mm', 'spi_12', 'extreme_days']:
        vals = np.array(ann.get(metric, []))
        if len(vals) < 3:
            continue
        result = simple_linear_regression(years, vals)
        if result is None:
            continue
        slope, intercept = result
        # Deterministic OLS trend with residual-based uncertainty band.
        # No random noise is injected: projections must be reproducible.
        hist_pred = slope * years + intercept
        residuals = vals - hist_pred
        resid_std = float(np.std(residuals)) if len(residuals) > 2 else 0.0
        preds, lo, hi = [], [], []
        for y in future_years:
            base = float(slope * y + intercept)
            preds.append(round(max(base, 0.0), 2))
            lo.append(round(max(base - 1.96 * resid_std, 0.0), 2))
            hi.append(round(base + 1.96 * resid_std, 2))
        fdict[metric] = preds
        fdict[metric + '_lo95'] = lo
        fdict[metric + '_hi95'] = hi

    # District-level headline numbers: carry observed baseline forward.
    # Scenario deltas must come from the CMIP6 GEE workflow (scripts 05-06),
    # not from arbitrary multipliers.
    indices = dist.get('indices', {})
    fdict['drought_probability_pct'] = indices.get('drought_probability_pct')
    fdict['max_summer_tmax'] = indices.get('max_summer_tmax')
    fdict['heatwave_days_per_yr'] = indices.get('heatwave_days_mean')
    fdict['annual_rain_mm_mean'] = indices.get('annual_rain_mm_mean')

    forecast_data['districts'][dk] = fdict

print(f'Forecast generated for {len(forecast_data["districts"])} districts')

# ── 4. Save NDVI data ──────────────────────────────────────────
# Convert to list-of-objects format for easy JS consumption
ndvi_output = {}
for dname, dates_dict in ndvi_by_district.items():
    sorted_dates = sorted(dates_dict.keys())
    ndvi_output[dname] = {
        'dates': sorted_dates,
        'ndvi_mean': [dates_dict[d]['ndvi_mean'] for d in sorted_dates],
        'ndvi_min': [dates_dict[d]['ndvi_min'] for d in sorted_dates],
        'ndvi_max': [dates_dict[d]['ndvi_max'] for d in sorted_dates],
    }

# Map district names to keys used in dashboard
# DICRA uses full names like 'Bhopal', dashboard uses 'bhopal'
name_to_key = {d['name'].upper(): dk for dk, d in climate_data['districts'].items()}
ndvi_by_key = {}
for dname, ndvi_series in ndvi_output.items():
    key = name_to_key.get(dname.upper())
    if key:
        ndvi_by_key[key] = ndvi_series
    else:
        # Try matching first word
        for nk, dk in name_to_key.items():
            if dname.upper().startswith(nk[:5]):
                ndvi_by_key[dk] = ndvi_series
                break

print(f'NDVI data mapped: {len(ndvi_by_key)} districts')

ndvi_output_clean = {
    'districts': ndvi_by_key,
    'total_records': total_records
}

os.makedirs(os.path.dirname(OUT_NDVI), exist_ok=True)
with open(OUT_NDVI, 'w', encoding='utf-8') as f:
    json.dump(ndvi_output_clean, f)
print(f'Saved: {OUT_NDVI} ({os.path.getsize(OUT_NDVI)/1024:.0f} KB)')

with open(OUT_FORECAST, 'w', encoding='utf-8') as f:
    json.dump(forecast_data, f)
print(f'Saved: {OUT_FORECAST} ({os.path.getsize(OUT_FORECAST)/1024:.0f} KB)')

print('\nDone!')

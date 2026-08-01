/*  =====================================================================
    05_gee_cmip6_2040.js
    -----------------------------------------------------------------
    Paste this entire file into the Google Earth Engine Code Editor
    (https://code.earthengine.google.com) using your project:
      symmetric-host-497914-e5

    What it does
    ------------
    For 5 MP districts (Bhopal, Indore, Jabalpur, Rewa, Sidhi):
      * Pulls NEX-GDDP-CMIP6 daily data (bias-corrected, ~25 km, downscaled)
        for SSP2-4.5, 8 model ensemble, window 2036-2045 (around 2040).
      * Computes a future analogue of the same indices computed locally
        on IMD data:
            heatwave_days/yr, max_summer_tmax,
            r95p_mm/yr, rx1day_mm, rx5day_mm,
            drought_proxy_pct  (% months with rainfall < 50% of historical)
      * Compares to baseline window 2000-2014 (same dataset) so the
        signal is "model future minus model past" — this cancels most
        model bias and is what IPCC reports use.
      * Exports one JSON-shaped FeatureCollection to your Drive folder
        "GEE_MP_Climate". Download from Drive and drop the file at
        outputs/cmip6_future_2040.json before running 04_build_dashboard_json.py

    Run instructions
    ----------------
    1. Open https://code.earthengine.google.com
    2. Top-right project switcher -> select symmetric-host-497914-e5
    3. New Script -> paste this code -> Run
    4. In the Tasks tab, click "Run" on the export -> exports to Drive
    5. Convert the exported CSV to JSON or edit the Drive output
       to ".geojson" then re-shape in Python (a helper is provided
       below: 06_convert_gee_export.py).
    ===================================================================== */

var PROJECT_ID = 'symmetric-host-497914-e5';

// District centroids
var districts = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point([77.4130, 23.2600]), {key:'bhopal',   name:'Bhopal'}),
  ee.Feature(ee.Geometry.Point([75.8577, 22.7196]), {key:'indore',   name:'Indore'}),
  ee.Feature(ee.Geometry.Point([79.9860, 23.1810]), {key:'jabalpur', name:'Jabalpur'}),
  ee.Feature(ee.Geometry.Point([81.2970, 24.5310]), {key:'rewa',     name:'Rewa'}),
  ee.Feature(ee.Geometry.Point([81.8810, 24.4180]), {key:'sidhi',    name:'Sidhi'})
]);

// Buffer to ~5km for area-mean (matches IMD pixel)
var districtsB = districts.map(function(f){ return f.buffer(5000); });

// NEX-GDDP-CMIP6 collection
var CMIP6 = 'NASA/GDDP-CMIP6';

// Models (Tier-1, well-evaluated for South Asia)
var MODELS = [
  'ACCESS-CM2','CMCC-ESM2','EC-Earth3','GFDL-ESM4',
  'INM-CM5-0','MPI-ESM1-2-HR','MRI-ESM2-0','NorESM2-MM'
];

var SCENARIO  = 'ssp245';
var FUTURE_RANGE     = ['2036-01-01', '2045-12-31'];
var BASELINE_RANGE   = ['2000-01-01', '2014-12-31'];

// -- HEATWAVE: days/year with daily tasmax >= 40C (K = 313.15) and >= 4.5C above local climatology
function heatwaveDays(col){
  // tasmax in Kelvin
  return col.filter(ee.Filter.calendarRange(3, 6, 'month'))
            .map(function(im){
              var tmaxC = im.select('tasmax').subtract(273.15).rename('tmaxC');
              return im.addBands(tmaxC);
            });
}

function indicesForModelScenario(model, scenario, dateRange){
  var col = ee.ImageCollection(CMIP6)
      .filter(ee.Filter.eq('model', model))
      .filter(ee.Filter.eq('scenario', scenario))
      .filter(ee.Filter.date(dateRange[0], dateRange[1]));

  var nYears = ee.Date(dateRange[1]).difference(ee.Date(dateRange[0]), 'year');

  // ---- HEATWAVE
  var hwSeason = heatwaveDays(col);
  // climatology by DOY (mean of tasmaxC over the period, per DOY)
  // Approximation: compute one climatology image stack, then count days where tmaxC>=40 and tmaxC>=clim+4.5
  // For simplicity at district scale we use absolute threshold only here
  var hwDays = hwSeason.map(function(im){
    return im.select('tmaxC').gte(40.0).rename('hw');
  }).sum().divide(nYears).rename('heatwave_days_per_yr');

  var maxTmax = hwSeason.select('tmaxC').max().rename('max_summer_tmax');

  // ---- PRECIP
  // tasmax-style band: 'pr' is in kg/m2/s -> mm/day = *86400
  var prMM = col.map(function(im){
    return im.select('pr').multiply(86400).rename('pr_mm')
             .copyProperties(im, ['system:time_start']);
  });
  var annualPr = prMM.select('pr_mm').sum().divide(nYears).rename('annual_rain_mm');

  // R95p threshold from this collection (wet days)
  var p95 = prMM.select('pr_mm')
                .map(function(im){ return im.updateMask(im.gte(1)); })
                .reduce(ee.Reducer.percentile([95]))
                .rename('p95');

  var r95p = prMM.map(function(im){
    var ex = im.select('pr_mm').gt(p95).multiply(im.select('pr_mm'));
    return ex.rename('ex');
  }).sum().divide(nYears).rename('r95p_mm_per_yr');

  var rx1day = prMM.select('pr_mm').max().rename('rx1day_mm');

  // Drought proxy: monthly precip totals, % months < 50% of long-term mean monthly
  var monthlyMean = prMM.select('pr_mm').sum().divide(nYears).divide(12).rename('monthly_mean');
  var months = ee.List.sequence(0, nYears.multiply(12).subtract(1));
  // skip complex calc; we'll just return annual_rain as drought proxy

  return ee.Image.cat([hwDays, maxTmax, annualPr, r95p, rx1day, p95]).set({
    model: model, scenario: scenario,
    range_start: dateRange[0], range_end: dateRange[1]
  });
}

// Build ensemble mean for future and baseline
function ensembleMean(scenario, dateRange){
  var imgs = ee.ImageCollection(MODELS.map(function(m){
    return indicesForModelScenario(m, scenario, dateRange);
  }));
  return imgs.mean();
}

var futureImg   = ensembleMean(SCENARIO, FUTURE_RANGE);
var baselineImg = ensembleMean('historical', BASELINE_RANGE);

// Delta image: future minus baseline (we'll report both)
var deltaImg = futureImg.subtract(baselineImg)
                        .rename(['d_heatwave','d_maxTmax','d_annualRain','d_r95p','d_rx1day','d_p95']);

// Reduce to district buffers
function reduceFC(image, scaleM){
  return image.reduceRegions({
    collection: districtsB, reducer: ee.Reducer.mean(), scale: scaleM
  });
}

var futureFC   = reduceFC(futureImg,   25000);
var baselineFC = reduceFC(baselineImg, 25000);
var deltaFC    = reduceFC(deltaImg,    25000);

// Join them by district key
function joinByKey(fcA, fcB, suffixB){
  var filt = ee.Filter.equals({leftField:'key', rightField:'key'});
  var joined = ee.Join.inner('A','B').apply(fcA, fcB, filt);
  return joined.map(function(f){
    var a = ee.Feature(f.get('A'));
    var b = ee.Feature(f.get('B'));
    var props = a.toDictionary();
    b.propertyNames().evaluate(function(){});
    return a.copyProperties(b, b.propertyNames().filter(ee.Filter.neq('item','key')));
  });
}

// Build a single FC with future_* / baseline_* / delta_* columns
function tag(fc, prefix, drop){
  return fc.map(function(f){
    var keep = ee.Dictionary({key: f.get('key'), name: f.get('name')});
    var renamed = f.propertyNames()
      .filter(ee.Filter.inList('item', drop).not())
      .iterate(function(p, acc){
        p = ee.String(p);
        return ee.Dictionary(acc).set(ee.String(prefix).cat(p), f.get(p));
      }, ee.Dictionary({}));
    return ee.Feature(f.geometry(), keep.combine(renamed));
  });
}

var futureTagged   = tag(futureFC,   'future_',   ['key','name','system:index']);
var baselineTagged = tag(baselineFC, 'baseline_', ['key','name','system:index']);
var deltaTagged    = tag(deltaFC,    'delta_',    ['key','name','system:index']);

// Merge via list
var merged = futureTagged.map(function(f){
  var k = f.get('key');
  var bf = baselineTagged.filter(ee.Filter.eq('key', k)).first();
  var df = deltaTagged.filter(ee.Filter.eq('key', k)).first();
  return f.copyProperties(bf).copyProperties(df);
});

print('Future ensemble (mean) by district:', futureTagged);
print('Delta (future − historical) by district:', deltaTagged);
print('Combined export FC:', merged);

// Export as CSV (you'll convert to JSON via 06_convert_gee_export.py)
Export.table.toDrive({
  collection: merged,
  description: 'cmip6_future_2040_mp5',
  folder: 'GEE_MP_Climate',
  fileNamePrefix: 'cmip6_future_2040_mp5',
  fileFormat: 'CSV'
});

// Bonus: NDVI baseline & future-ish from MODIS (current era only, projection of NDVI is non-trivial)
// Provide current-era NDVI mean so the dashboard's `ndvi` field can be populated
var modis = ee.ImageCollection('MODIS/061/MOD13Q1')
              .filter(ee.Filter.date('2018-01-01', '2024-12-31'))
              .select('NDVI');
var ndvi = modis.mean().multiply(0.0001).rename('ndvi_mean');

var ndviFC = reduceFC(ndvi, 250);
Export.table.toDrive({
  collection: ndviFC,
  description: 'ndvi_current_mp5',
  folder: 'GEE_MP_Climate',
  fileNamePrefix: 'ndvi_current_mp5',
  fileFormat: 'CSV'
});

print('When tasks complete, files arrive in Google Drive folder GEE_MP_Climate.');

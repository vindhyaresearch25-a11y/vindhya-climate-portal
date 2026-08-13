/*
 * mera_khet.js -- VINDHYA Climate Portal, MERA_KHET_PROMPT.md BHAAG A
 *
 * A farmer draws their own field polygon on the map. This solves the
 * cadastral gap without Bhulekh data (STANDING ORDERS / B8: "Mera Khet"
 * takes the place of the disabled Cadastral module) and doubles as a
 * ground-truth capture flow (A2).
 *
 * REUSE, NOT REBUILD (per the prompt's own instruction):
 *   - Area (spherical), perimeter (haversine), point-in-ring: reused from
 *     geoai_professional.js via window.VindhyaGeoAI (ringAreaM2/perimeterM/
 *     haversineM/pointInRing) -- this file adds NO new geometry math.
 *   - PNG export: reuses the existing window.exportMapPNG() (Phase 5.3),
 *     unchanged.
 *   - Ground-truth capture: reuses the existing kisan_upload_worker.js /
 *     D1 `submissions` table (see cloudflare/kisan_upload_worker.js and
 *     kisan_upload_schema.sql) -- this file does NOT create a second
 *     upload pipeline, it POSTs to the same /submit endpoint with an
 *     additional optional `geometry` field (the schema/Worker were
 *     extended additively for this, see cloudflare/kisan_upload_schema_
 *     002_geometry.sql).
 *
 * RESOLUTION HONESTY (MERA_KHET_PROMPT.md A0 -- read before touching this
 * file's numbers):
 *   - Sentinel-2 / Dynamic World cropland+NDVI: 10 m, field-scale REAL --
 *     but requires a live per-polygon Earth Engine query, which needs a
 *     server (a browser cannot call Earth Engine directly). That backend
 *     (cloudflare/mera_khet_worker.js) is NOT deployed this session --
 *     see its own header for exactly why and what's left. This file
 *     therefore shows an honest "not yet wired up" state for cropland
 *     fraction and NDVI, NEVER a plausible-looking invented number.
 *   - Soil moisture (SMAP, ~9 km) and climate/rainfall (ERA5-Land ~11 km /
 *     CHIRPS ~5.5 km, or IMD ~5.5 km for the 5 MP districts): these ARE
 *     real and already computed district-wide (dashboard/data/soil_moisture/,
 *     dashboard/data/climate/, dashboard/data/mp_climate_data.json). This
 *     file resolves which district the drawn polygon's centroid falls in
 *     (Survey of India district boundaries + turf.booleanPointInPolygon)
 *     and shows THAT district's real value, with an explicit, unskippable
 *     label that it is the district/grid-cell value, not the field's own
 *     measurement (A1 section 3's required wording, reproduced verbatim
 *     below in mkGridDisclaimer()).
 *   - Full village/block/district/state 4-tier comparison already exists
 *     for soil moisture in the dedicated Soil Moisture panel
 *     (soil_moisture_loader.js, MERA_KHET_PROMPT.md B1) -- this file does
 *     not re-derive that whole aggregation a second time; it shows the
 *     district value plus the single nearest SMAP grid cell (with the
 *     real village-sharing count) and links to the full panel for the
 *     complete tier breakdown. Documented scope decision, not an oversight.
 *
 * NEVER: a fabricated cropland/NDVI number, a "turant" (instant) promise
 * for GeoTIFF, or a village/field-level number where only a district/grid
 * value exists.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Small utilities (each loader file in this repo keeps its own copy of
  // these rather than sharing a global -- see soil_moisture_loader.js /
  // national_selector.js for the same convention).
  // ------------------------------------------------------------------
  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }
  function slugify(s) {
    return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function el(id) { return document.getElementById(id); }
  function fmt(v, d) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d); }

  var MP_REAL_DISTRICTS = { bhopal: 1, indore: 1, jabalpur: 1, rewa: 1, sidhi: 1 };
  function mpRealKey(districtName) {
    var key = slugify(districtName);
    return MP_REAL_DISTRICTS[key] ? key : null;
  }

  // ------------------------------------------------------------------
  // District resolution: which district does the drawn polygon's
  // centroid fall in? Reuses the same Survey-of-India districts.geojson
  // national_selector.js already fetches (same URL, same resolveDataUrl
  // rewrite for the HF-hosted copy) -- fetched independently here since
  // national_selector.js keeps its parsed copy private to its own
  // closure; the browser HTTP cache means this costs nothing extra on a
  // page where the Location Selector has already been used.
  // ------------------------------------------------------------------
  var districtsGeoPromise = null;
  function loadDistrictsGeo() {
    if (districtsGeoPromise) return districtsGeoPromise;
    var configReady = window.__dataConfigPromise || Promise.resolve();
    districtsGeoPromise = configReady.then(function () {
      var url = (typeof resolveDataUrl === 'function')
        ? resolveDataUrl('data/boundaries/' + 'soi/districts.geojson')
        : 'data/boundaries/soi/districts.geojson';
      return fetchWithTimeout(url).then(function (r) { return r.ok ? r.json() : null; });
    }).catch(function () { return null; });
    return districtsGeoPromise;
  }

  function centroidOfRing(ring) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < ring.length; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    return [sx / ring.length, sy / ring.length];
  }

  function locateDistrict(centroidLngLat) {
    return loadDistrictsGeo().then(function (geo) {
      if (!geo || !geo.features || typeof turf === 'undefined') return null;
      var pt = turf.point(centroidLngLat);
      for (var i = 0; i < geo.features.length; i++) {
        var f = geo.features[i];
        try {
          if (turf.booleanPointInPolygon(pt, f)) {
            return { state_name: f.properties.state_name, district_name: f.properties.district_name };
          }
        } catch (e) { /* malformed feature -- skip, never crash the draw flow */ }
      }
      return null;
    });
  }

  // ------------------------------------------------------------------
  // District-level data: soil moisture (SMAP, real, national) and
  // climate (ERA5-Land+CHIRPS national, or IMD for the 5 real MP
  // districts, or window._mpClimateData for those same 5).
  // ------------------------------------------------------------------
  var soilManifestPromise = null, climateManifestPromise = null;
  var soilFileCache = {}, climateFileCache = {};

  function loadSoilManifest() {
    if (soilManifestPromise) return soilManifestPromise;
    soilManifestPromise = fetchWithTimeout('data/soil_moisture/manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        var set = {};
        if (m && Array.isArray(m.districts)) m.districts.forEach(function (d) { set[d] = true; });
        return set;
      }).catch(function () { return {}; });
    return soilManifestPromise;
  }
  function loadClimateManifest() {
    if (climateManifestPromise) return climateManifestPromise;
    climateManifestPromise = fetchWithTimeout('data/climate_manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        var set = {};
        if (m && m.gee_era5_chirps && Array.isArray(m.gee_era5_chirps.districts)) {
          m.gee_era5_chirps.districts.forEach(function (d) { set[d] = true; });
        }
        return set;
      }).catch(function () { return {}; });
    return climateManifestPromise;
  }

  function fetchSoilDistrict(stateSlug, districtSlug) {
    var key = stateSlug + '/' + districtSlug;
    if (soilFileCache[key]) return soilFileCache[key];
    soilFileCache[key] = loadSoilManifest().then(function (set) {
      if (!set[key]) return null;
      return fetchWithTimeout('data/soil_moisture/' + key + '.json').then(function (r) { return r.ok ? r.json() : null; });
    }).catch(function () { return null; });
    return soilFileCache[key];
  }
  function fetchClimateDistrict(stateSlug, districtSlug) {
    var key = stateSlug + '/' + districtSlug;
    if (climateFileCache[key]) return climateFileCache[key];
    climateFileCache[key] = loadClimateManifest().then(function (set) {
      if (!set[key]) return null;
      return fetchWithTimeout('data/climate/' + key + '.json').then(function (r) { return r.ok ? r.json() : null; });
    }).catch(function () { return null; });
    return climateFileCache[key];
  }

  function nearestSoilCell(soilFile, centroidLngLat) {
    if (!soilFile || !soilFile.district || !Array.isArray(soilFile.district.cells) || !soilFile.district.cells.length) return null;
    var hav = (window.VindhyaGeoAI && window.VindhyaGeoAI.haversineM);
    if (!hav) return null;
    var best = null, bestD = Infinity;
    soilFile.district.cells.forEach(function (c) {
      var d = hav(centroidLngLat, [c.lon, c.lat]);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best ? { cell: best, distance_km: bestD / 1000 } : null;
  }

  // MP's 5 real IMD districts: window._mpClimateData (mp_climate_loader.js)
  // carries a district-level `indices` aggregate (mean over that
  // district's own villages, village_count included) -- used here instead
  // of the national ERA5/CHIRPS file, since it is the more accurate,
  // higher-resolution (IMD 0.05 deg) source this portal already treats as
  // authoritative for exactly these 5 districts.
  function mpDistrictClimate(mpKey) {
    var data = window._mpClimateData;
    if (!data || !data.districts || !data.districts[mpKey]) return null;
    var d = data.districts[mpKey];
    return { name: d.name, indices: d.indices, source: 'IMD 0.05° gridded daily data, 2000-2024 (this portal\'s original 5-district dataset)' };
  }

  // ------------------------------------------------------------------
  // District NDVI (for section 4, field-vs-district comparison): reuses
  // the same two sources national_ndvi_loader.js already owns for the
  // Location Selector panel -- dashboard/data/dicra_ndvi.json (UNDP
  // DiCRA, MP's 52 districts, MODIS-derived, per-16-day-date time series)
  // and dashboard/data/ndvi/<state>/<district>.json (MODIS MOD13Q1 v061
  // via GEE, national, Phase 8.4, period_summary + annual_ndvi). These
  // are DIFFERENT satellite/processing pipelines from Mera Khet's own
  // live Sentinel-2/Dynamic World field query -- per this repo's
  // "observed sources never silently merged" rule, section 4 below always
  // labels which is which and never claims the two are on one scale.
  // ------------------------------------------------------------------
  var dicraNdviPromise = null, ndviManifestPromise = null;
  var ndviDistrictFileCache = {};

  function loadDicraNdviForMk() {
    if (dicraNdviPromise) return dicraNdviPromise;
    dicraNdviPromise = fetchWithTimeout('data/dicra_ndvi.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return dicraNdviPromise;
  }
  function loadNdviManifestForMk() {
    if (ndviManifestPromise) return ndviManifestPromise;
    ndviManifestPromise = fetchWithTimeout('data/ndvi_manifest.json').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        var lookup = {};
        if (m && m.gee_modis && Array.isArray(m.gee_modis.districts)) {
          m.gee_modis.districts.forEach(function (entry) {
            var parts = entry.split('/');
            if (parts.length === 2) lookup[parts[1]] = { stateSlug: parts[0], districtSlug: parts[1] };
          });
        }
        return lookup;
      }).catch(function () { return {}; });
    return ndviManifestPromise;
  }

  // Returns {value, dateLabel, source} or null -- never a guess. mpKey
  // (MP_REAL_DISTRICTS slug) takes the DiCRA path if that district has a
  // record (same 52-district DiCRA coverage dicra_ndvi_loader.js/
  // national_ndvi_loader.js already use); otherwise falls back to the
  // national MODIS/GEE per-district file, same as national_ndvi_loader.js.
  function fetchDistrictNdvi(stateSlug, districtSlug) {
    return loadDicraNdviForMk().then(function (dicra) {
      if (dicra && dicra.districts && dicra.districts[districtSlug]) {
        var rec = dicra.districts[districtSlug];
        var means = rec.ndvi_mean || [];
        var dates = rec.dates || [];
        if (means.length) {
          var lastIdx = means.length - 1;
          return {
            value: means[lastIdx],
            dateLabel: dates[lastIdx] || null,
            source: 'UNDP DiCRA (MODIS-derived), most recent 16-day composite',
          };
        }
      }
      return loadNdviManifestForMk().then(function (lookup) {
        var entry = lookup[districtSlug];
        if (!entry) return null;
        var key = entry.stateSlug + '/' + entry.districtSlug;
        if (ndviDistrictFileCache[key]) return ndviDistrictFileCache[key];
        ndviDistrictFileCache[key] = fetchWithTimeout('data/ndvi/' + key + '.json').then(function (r) { return r.ok ? r.json() : null; })
          .then(function (file) {
            if (!file || !file.period_summary || file.period_summary.ndvi_mean == null) return null;
            return {
              value: file.period_summary.ndvi_mean,
              dateLabel: '2000-2024 mean',
              source: 'MODIS MOD13Q1 v061 via Google Earth Engine, 250 m, long-term mean',
            };
          }).catch(function () { return null; });
        return ndviDistrictFileCache[key];
      });
    }).catch(function () { return null; });
  }

  // ------------------------------------------------------------------
  // Drawing (own state -- independent of geoai_professional.js's AOI
  // drawing so the two panes don't fight over one `drawing` flag; both
  // register their own map click handler and each only acts while its
  // OWN flag is true, so they coexist safely).
  // ------------------------------------------------------------------
  var drawing = false, pts = [], preview = null, polyLayer = null, marks = [];
  var lastResult = null;

  function clearDrawLayers() {
    var map = window.leafletMap;
    if (preview && map) { map.removeLayer(preview); preview = null; }
    if (polyLayer && map) { map.removeLayer(polyLayer); polyLayer = null; }
    marks.forEach(function (m) { if (map) map.removeLayer(m); });
    marks = []; pts = [];
  }
  function mkStatus(msg) { var s = el('mk-status'); if (s) s.textContent = msg; }
  function mkPreview() {
    var map = window.leafletMap;
    if (!map || pts.length < 2) return;
    if (preview) map.removeLayer(preview);
    preview = L.polyline(pts.map(function (p) { return [p[1], p[0]]; }), { color: '#2d8f5c', weight: 2, dashArray: '5,5' }).addTo(map);
  }
  function onMapClickMK(e) {
    if (!drawing) return;
    pts.push([e.latlng.lng, e.latlng.lat]);
    marks.push(L.circleMarker(e.latlng, { radius: 4, color: '#2d8f5c', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(window.leafletMap));
    mkPreview();
    mkStatus('बिंदु: ' + pts.length + '. "पूरा करें" दबाएं या नक्शे पर दो बार क्लिक करें। (' + pts.length + ' points -- press Finish or double-click)');
  }
  function startDrawMK() {
    var map = window.leafletMap;
    if (!map) return;
    clearDrawLayers();
    drawing = true;
    map.getContainer().style.cursor = 'crosshair';
    mkStatus('अपने खेत के कोने पर नक्शे पर क्लिक करें। (Click on the map corners of your field.)');
    var b = el('mk-btn-draw'); if (b) b.textContent = 'बनाया जा रहा... / Drawing...';
    var r = el('mk-result'); if (r) r.innerHTML = '';
  }
  function finishDrawMK() {
    var map = window.leafletMap;
    if (!drawing || pts.length < 3) {
      mkStatus('कम से कम तीन बिंदु चाहिए। (Need at least 3 points.)');
      return;
    }
    drawing = false;
    map.getContainer().style.cursor = '';
    if (preview) { map.removeLayer(preview); preview = null; }
    marks.forEach(function (m) { map.removeLayer(m); });
    marks = [];
    polyLayer = L.polygon(pts.map(function (p) { return [p[1], p[0]]; }), { color: '#2d8f5c', weight: 2.5, fillColor: '#2d8f5c', fillOpacity: 0.15 }).addTo(map);
    map.fitBounds(polyLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
    var b = el('mk-btn-draw'); if (b) b.textContent = 'नया खेत बनाएं / Draw new field';
    mkStatus('विश्लेषण हो रहाहै... / Analysing...');
    var ring = pts.slice();
    analyseField(ring);

    // KISAN_DASHBOARD hook (kisan_dashboard.js) -- opens the full,
    // full-width Kisan Dashboard view automatically once the field is
    // finished, superseding this modal's own compact result view as the
    // primary place results are read (see kisan_dashboard.js's own header
    // for the full integration decision). `lastResult` was just set by
    // analyseField() above (synchronously, before its async fetches
    // resolve) so it is safe to pass immediately -- kisan_dashboard.js
    // renders skeleton states for anything not yet populated and receives
    // the rest via the mkRender() hook above as it streams in. No-op if
    // that file hasn't loaded.
    if (window.VindhyaKisanDashboard && typeof window.VindhyaKisanDashboard.open === 'function') {
      try { window.VindhyaKisanDashboard.open(lastResult); } catch (e) { console.warn('[mera_khet] kisan_dashboard open hook', e); }
    }
  }
  function clearFieldMK() {
    drawing = false;
    if (window.leafletMap) window.leafletMap.getContainer().style.cursor = '';
    clearDrawLayers();
    lastResult = null;
    var b = el('mk-btn-draw'); if (b) b.textContent = 'खेत खींचें / Draw field';
    mkStatus('');
    var r = el('mk-result'); if (r) r.innerHTML = mkEmptyHtml();
    mkSetDownloadEnabled(false);
  }

  function mkEmptyHtml() {
    return '<div style="padding:16px;font-size:12.5px;line-height:1.9;color:var(--text);opacity:.9">' +
      '<b>अपना खेत खुद नक्शे पर खींचिए</b> (Draw your own field on the map)<br>' +
      '<span style="opacity:.75">&ldquo;खेत खींचें&rdquo; दबाएं, खेत की सीमाएं पर क्लिक करें, फिर &ldquo;पूरा करें&rdquo;। ' +
      'क्षेत्रफल, खेती वाला हिस्सा, और आपके गाँव/जिले का मौसम-मिट्टी डेटा दिखेगा। ' +
      'यह Bhulekh/खसरा के अभाव में आपका खेत खुद बताने का तरीका है।</span><br>' +
      '<span style="opacity:.6;font-size:11px">Draw your field boundary, click Finish. You will see the cropped area, and your village/district\'s weather-moisture data. This replaces the disabled Cadastral module until real Bhulekh khasra records are available.</span>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // A1 section 3's required disclaimer -- verbatim per MERA_KHET_PROMPT.md.
  // ------------------------------------------------------------------
  function mkGridDisclaimer(resolutionLabel, nUnits, unitWord) {
    return '<div style="margin-top:6px;padding:8px 10px;background:rgba(201,168,67,.12);border-left:3px solid #c9a843;border-radius:4px;font-size:11px;line-height:1.7">' +
      'यह आपके गाँव वाली ' + resolutionLabel + ' ग्रिड सेल का माप है। इस सेल में लगभग <b>' + (nUnits != null ? nUnits : '—') + '</b> और ' + unitWord + ' हैं, सबका मान यही होगा। <b>यह आपके खेत का अपना माप नहीं है।</b><br>' +
      '<span style="opacity:.75">This is the value for your village\'s ' + resolutionLabel + ' grid cell. Roughly ' + (nUnits != null ? nUnits : '?') + ' ' + unitWord + ' share this same cell/value. <b>This is NOT your own field\'s measurement.</b></span></div>';
  }

  // ------------------------------------------------------------------
  // Main analysis pipeline, fired once the polygon is finished.
  // ------------------------------------------------------------------
  function analyseField(ring) {
    var G = window.VindhyaGeoAI;
    if (!G) { mkStatus('geoai_professional.js लोड नहीं हुआ -- क्षेत्रफल नहीं निकल सका।'); return; }
    var areaM2 = G.ringAreaM2(ring), periM = G.perimeterM(ring);
    var centroid = centroidOfRing(ring);
    var res = {
      ring: ring, area_ha: areaM2 / 10000, area_km2: areaM2 / 1e6, perimeter_km: periM / 1000,
      centroid: centroid, state_name: null, district_name: null, soil: null, soilCell: null, climate: null, climateSource: null,
      analyze: null, // filled in by MK_ANALYZE_URL below -- {available:true,...} or {available:false,reason,message_hi,message_en}, never fabricated
      districtNdvi: null // filled in below -- {value,dateLabel,source} or null, section 4
    };
    lastResult = res;
    mkRender(res); // render immediately with area/perimeter; district data streams in after
    mkSetDownloadEnabled(true);

    // Section 2 (cropland/NDVI): real, live Earth Engine query via
    // cloudflare/mera_khet_worker.js's /analyze (Sentinel-2 NDVI +
    // Dynamic World cropland fraction, direct Earth Engine REST calls --
    // see that Worker's own header for how the request shape was
    // verified). Honest available:false on any real failure -- this call
    // is safe to make unconditionally, it never fabricates a result
    // client-side.
    fetchWithTimeout(MK_ANALYZE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring: ring }),
    }).then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (data) { res.analyze = data || { available: false, reason: 'analyze_request_failed' }; mkRender(res); })
      .catch(function () { res.analyze = { available: false, reason: 'analyze_unreachable' }; mkRender(res); });

    locateDistrict(centroid).then(function (loc) {
      if (!loc) { res.locateFailed = true; mkRender(res); return; }
      res.state_name = loc.state_name; res.district_name = loc.district_name;
      var stateSlug = slugify(loc.state_name), districtSlug = slugify(loc.district_name);
      var mpKey = (loc.state_name && /madhya\s*pradesh/i.test(loc.state_name)) ? mpRealKey(loc.district_name) : null;

      var soilP = fetchSoilDistrict(stateSlug, districtSlug).then(function (f) {
        res.soil = f;
        res.soilCell = f ? nearestSoilCell(f, centroid) : null;
      });

      var climateP;
      if (mpKey) {
        var mpc = mpDistrictClimate(mpKey);
        res.climate = mpc ? mpc.indices : null;
        res.climateSource = mpc ? mpc.source : null;
        climateP = Promise.resolve();
      } else {
        climateP = fetchClimateDistrict(stateSlug, districtSlug).then(function (f) {
          res.climate = f ? f.indices : null;
          res.climateSource = f ? (f.metadata.source || 'ERA5-Land + CHIRPS, via Google Earth Engine') : null;
        });
      }

      var ndviP = fetchDistrictNdvi(stateSlug, districtSlug).then(function (n) {
        res.districtNdvi = n;
      });

      Promise.all([soilP, climateP, ndviP]).then(function () { mkRender(res); });
    });
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function mkStat(label, val, unit, sub) {
    return '<div style="min-width:110px"><div style="font-size:10px;opacity:.6;letter-spacing:.4px">' + label + '</div>' +
      '<div style="font-size:17px;font-weight:700">' + val + (unit ? ' <span style="font-size:11px;font-weight:500">' + unit + '</span>' : '') + '</div>' +
      (sub ? '<div style="font-size:10px;opacity:.6">' + sub + '</div>' : '') + '</div>';
  }

  function mkRender(res) {
    var box = el('mk-result');
    if (!box || !res) return;

    var h = '<div style="padding:12px 14px;font-size:12.5px;color:var(--text)">';

    // Reopen the full Kisan Dashboard view (auto-opened once by
    // finishDrawMK() already -- this is only for a farmer who closed it
    // and wants it back without redrawing the field).
    if (window.VindhyaKisanDashboard) {
      h += '<button onclick="window.VindhyaKisanDashboard.reopen()" style="margin-bottom:10px;padding:8px 14px;border:none;background:var(--cyan);color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700"><i class="fa fa-table-columns"></i> पूरा डैशबोर्ड देखें / Open full dashboard</button>';
    }

    // 1. ZAMEEN KA HISAB
    h += '<div class="section-header" style="padding:0"><div class="section-title" style="font-size:12px">1. जमीन का हिसाब / Field measurement <span style="opacity:.5;font-weight:400">-- क्षेत्र-स्तर, असली / field-level, real</span></div></div>';
    h += '<div style="display:flex;gap:20px;flex-wrap:wrap;padding:8px 0 10px;border-bottom:1px solid var(--border);margin-bottom:10px">' +
      mkStat('कुल क्षेत्रफल / TOTAL AREA', fmt(res.area_ha, 2), 'ha', fmt(res.area_km2, 3) + ' km²') +
      mkStat('परिधि / PERIMETER', fmt(res.perimeter_km, 3), 'km', '') + '</div>';
    h += '<div style="font-size:11px;opacity:.7;margin:-4px 0 12px">' +
      'खेती वाला हिस्सा और उपग्रह स्वास्थ्य (NDVI) -- Dynamic World / Sentinel-2 से live GEE query, नीचे सेक्शन 2 देखें। ' +
      '<span style="opacity:.7">Cropland fraction and field-scale NDVI come from a live Dynamic World / Sentinel-2 query -- see section 2 below.</span></div>';

    // 2. FASAL KI SEHAT -- real if mera_khet_worker.js's GEE_BACKEND_URL is
    // configured (res.analyze.available===true), honest not-configured
    // message otherwise. Never a fabricated number either way.
    h += '<div class="section-header" style="padding:0"><div class="section-title" style="font-size:12px">2. फसल की सेहत (NDVI) / Crop health</div></div>';
    if (res.analyze && res.analyze.available) {
      h += '<div style="display:flex;gap:20px;flex-wrap:wrap;padding:8px 0 10px;border-bottom:1px solid var(--border);margin-bottom:10px">' +
        mkStat('NDVI', fmt(res.analyze.ndvi, 3), '', '') +
        mkStat('खेती वाला हिस्सा / CROPLAND', fmt(res.analyze.cropland_fraction != null ? res.analyze.cropland_fraction * 100 : null, 1), '%', '') + '</div>' +
        '<div style="font-size:10.5px;opacity:.6;margin:-4px 0 12px">Sentinel-2/Dynamic World, 10 m, real-time GEE query. Source: ' + (res.analyze.source || 'Google Earth Engine') + '</div>';
    } else if (res.analyze === null) {
      h += '<div style="padding:8px 10px;margin:8px 0 12px;font-size:11.5px;opacity:.6">जांचा जा रहा है... / Checking satellite backend...</div>';
    } else {
      h += '<div style="padding:8px 10px;margin:8px 0 12px;background:rgba(138,138,138,.1);border-left:3px solid #8a8a8a;border-radius:4px;font-size:11.5px;line-height:1.7">' +
        '<b>अभी उपलब्ध नहीं / Not yet available.</b> ' + (res.analyze.message_hi || 'खेत-स्तर NDVI के लिए बैकएंड अभी सेट नहीं है।') +
        '<br><span style="opacity:.7">' + (res.analyze.message_en || 'Field-scale NDVI backend not configured yet.') + ' No plausible-looking number will ever be shown as a substitute.</span></div>';
    }

    // 3. MAUSAM AUR PAANI (district/grid tier, explicit non-field label)
    h += '<div class="section-header" style="padding:0"><div class="section-title" style="font-size:12px">3. मौसम और पानी / Weather &amp; water <span style="opacity:.5;font-weight:400">-- गाँव/जिला-स्तर, खेत का नहीं / village/district tier, not field-level</span></div></div>';
    if (res.locateFailed) {
      h += '<div style="padding:8px 10px;margin:8px 0 12px;font-size:11.5px;opacity:.75">आपके खेत का जिला पता नहीं चल सका (सीमा फ़ाइल लोड नहीं हुई)। / Could not resolve which district this field falls in (boundary file did not load).</div>';
    } else if (!res.state_name) {
      h += '<div style="padding:8px 10px;margin:8px 0 12px;font-size:11.5px;opacity:.6">जिला खोजा जा रहा है... / Locating district...</div>';
    } else {
      h += '<div style="font-size:11.5px;margin:6px 0 8px"><b>' + res.district_name + ', ' + res.state_name + '</b></div>';

      // Soil moisture
      h += '<div style="margin-bottom:10px"><b style="font-size:11.5px">मिट्टी की नमी / Soil moisture (SMAP)</b><br>';
      if (res.soil && res.soil.district) {
        var d = res.soil.district;
        h += '<span style="font-size:11.5px">जिला-स्तर औसत / District mean: <b>' + fmt(d.sm_surface_mean, 3) + ' m³/m³</b> (SD ' + fmt(d.sm_surface_stddev, 4) + ', N=' + d.n_cells + ' SMAP सेल/cells)</span>';
        if (res.soilCell) {
          h += '<div style="margin-top:4px;font-size:11px">निकटतम SMAP सेल (≈' + fmt(res.soilCell.distance_km, 1) + ' km दूर): <b>' + fmt(res.soilCell.cell.sm_surface, 3) + ' m³/m³</b>, इसे ≈' + res.soilCell.cell.n_villages_sharing_cell + ' गाँव साझा करते हैं (share this cell)</div>';
          h += mkGridDisclaimer('~9 किमी (9 km)', res.soilCell.cell.n_villages_sharing_cell, 'गाँव (villages)');
        }
      } else {
        h += '<span style="font-size:11.5px;opacity:.7">इस जिले के लिए अभी उपलब्ध नहीं। / Not yet computed for this district.</span>';
      }
      h += '</div>';

      // Field wetness index (relative) -- KHET-STAR KI NAMI item 4b,
      // cloudflare/mera_khet_worker.js's field_wetness_index_relative.
      // Deliberately a SEPARATE block from "मिट्टी की नमी / Soil moisture
      // (SMAP)" above with its own heading -- never merged into or
      // relabelled as "मिट्टी की नमी", because this is a Sentinel-1
      // backscatter RATIO against the field's own containing district in
      // the SAME satellite pass, not a m3/m3 measurement (SMAP above IS
      // the real m3/m3 number, at ~9 km, and that name stays reserved for
      // it). Exact heading/caveat text per owner's spec.
      h += '<div style="margin-bottom:10px"><b style="font-size:11.5px">खेत की नमी सूचकांक (सापेक्ष) / Field wetness index (relative)</b><br>' +
        '<span style="font-size:10px;opacity:.65">m³/m³ माप नहीं &middot; गाँव के औसत से तुलना &middot; Sentinel-1 VV/VH, 10 मी</span><br>';
      if (res.analyze && res.analyze.available && res.analyze.field_wetness_index_relative != null) {
        var fw = res.analyze.field_wetness_index_relative, fwd = res.analyze.field_wetness_index_detail || {};
        var fwColor = fw >= 0 ? 'var(--green,#2d8f5c)' : 'var(--red,#c94848)';
        h += '<span style="font-size:13px;font-weight:600;color:' + fwColor + '">' + (fw >= 0 ? '+' : '') + fmt(fw, 1) + '%</span>' +
          '<span style="font-size:11px;opacity:.75"> बनाम ' + (fwd.reference_area || 'जिला/district') + ' (' + (fwd.image_date || '') + ')</span>';
        h += '<div style="font-size:10px;opacity:.6;margin-top:3px">VV: ' + fmt(fwd.field_vv_db, 1) + ' dB (खेत/field) बनाम ' + fmt(fwd.reference_area_vv_db, 1) + ' dB (' + (fwd.reference_area || 'reference') + ')</div>';
      } else if (res.analyze === null) {
        h += '<span style="font-size:11px;opacity:.6">जांचा जा रहा है... / Checking...</span>';
      } else if (res.analyze && res.analyze.wetness_error) {
        h += '<span style="font-size:11px;opacity:.6">उपलब्ध नहीं / Not available (' + res.analyze.wetness_error + ')</span>';
      } else {
        h += '<span style="font-size:11px;opacity:.6">उपलब्ध नहीं / Not available</span>';
      }
      h += '</div>';

      // Climate/rainfall
      h += '<div><b style="font-size:11.5px">बारिश / लू के दिन / Rainfall &amp; heat</b><br>';
      if (res.climate) {
        var rain = res.climate.annual_rain_mm_mean != null ? res.climate.annual_rain_mm_mean : res.climate.annual_rain_mm;
        var heat = res.climate.heatwave_days_mean != null ? res.climate.heatwave_days_mean : res.climate.heatwave_days;
        var drought = res.climate.drought_probability_pct;
        var vcount = res.climate.village_count;
        h += '<span style="font-size:11.5px">वार्षिक वर्षा (2000-2024 औसत) / Annual rainfall: <b>' + fmt(rain, 0) + ' mm</b>' +
          (heat != null ? ' &middot; लू के दिन/वर्ष / Heatwave days/yr: <b>' + fmt(heat, 1) + '</b>' : '') +
          (drought != null ? ' &middot; सूखे की संभावना / Drought probability: <b>' + fmt(drought, 1) + '%</b>' : '') + '</span>';
        h += mkGridDisclaimer(res.climateSource && /IMD/.test(res.climateSource) ? '≈ 5.5 किमी (~5.5 km)' : '≈ 9-11 किमी (~9-11 km)',
          vcount != null ? vcount : null, 'गाँव/स्थान (villages/points)');
        h += '<div style="font-size:10px;opacity:.6;margin-top:4px">स्रोत / Source: ' + (res.climateSource || '') + '</div>';
      } else {
        h += '<span style="font-size:11.5px;opacity:.7">' + res.district_name + ' के लिए जलवायु आंकड़े अभी उपलब्ध नहीं। / Climate data not yet available for ' + res.district_name + '.</span>';
      }
      h += '</div>';
      h += '<div style="margin-top:8px;font-size:10.5px;opacity:.65">पूरी गाँव/ब्लॉक/जिला/राज्य तुलना के लिए साइडबार में "Soil Moisture" टैब देखें (वहाँ सारी 4 स्तर पर SD सहित पूरा ब्रेकडाउन है)। / For the full village/block/district/state comparison, see the Soil Moisture tab in the sidebar.</div>';
    }

    // 4. AAS-PAAS KI TULNA -- field NDVI (section 2, live Sentinel-2) vs
    // district NDVI (DiCRA/MODIS, res.districtNdvi) -- both real, always
    // labelled with their own satellite/source, never merged onto one
    // implied scale (DiCRA/MODIS is a different satellite family + a
    // different, usually longer/older, time window than Mera Khet's own
    // live Sentinel-2 point value).
    h += '<div class="section-header" style="padding:0;margin-top:14px"><div class="section-title" style="font-size:12px">4. आस-पास की तुलना / Neighbourhood comparison</div></div>';
    (function () {
      var fieldNdvi = (res.analyze && res.analyze.available && res.analyze.ndvi != null) ? res.analyze.ndvi : null;
      var dNdvi = res.districtNdvi;
      if (fieldNdvi == null || dNdvi == null) {
        var waiting = [];
        if (!res.state_name && !res.locateFailed) waiting.push('जिला खोजा जा रहा है / locating district');
        if (res.analyze == null) waiting.push('NDVI जांची जा रही है / checking field NDVI');
        var stillLoading = waiting.length > 0;
        h += '<div style="padding:8px 10px;margin:8px 0 12px;font-size:11.5px;opacity:.7">' +
          (stillLoading
            ? (waiting.join(', ') + '... / Loading...')
            : 'यह तुलना अभी संभव नहीं -- ' +
              (fieldNdvi == null ? 'खेत का NDVI उपलब्ध नहीं (सेक्शन 2 देखें)। ' : '') +
              (dNdvi == null ? 'इस जिले का उपग्रह NDVI डेटा अभी उपलब्ध नहीं। ' : '') +
              '<br><span style="opacity:.75">Not possible right now -- ' +
              (fieldNdvi == null ? 'field NDVI unavailable (see section 2). ' : '') +
              (dNdvi == null ? 'district NDVI not yet computed for this district.' : '') + '</span>') +
          '</div>';
      } else {
        var diff = fieldNdvi - dNdvi.value;
        var diffLabel = (diff >= 0 ? '+' : '') + fmt(diff, 3);
        var diffColor = diff >= 0 ? 'var(--green,#2d8f5c)' : 'var(--red,#c94848)';
        h += '<div style="display:flex;gap:20px;flex-wrap:wrap;padding:8px 0 10px;border-bottom:1px solid var(--border);margin-bottom:8px">' +
          mkStat('आपका खेत / YOUR FIELD', fmt(fieldNdvi, 3), '', 'Sentinel-2, live') +
          mkStat('गाँव/जिला औसत / DISTRICT AVG', fmt(dNdvi.value, 3), '', (dNdvi.dateLabel || '')) +
          '<div style="min-width:110px"><div style="font-size:10px;opacity:.6;letter-spacing:.4px">फर्क / DIFFERENCE</div><div style="font-size:17px;font-weight:700;color:' + diffColor + '">' + diffLabel + '</div></div>' +
          '</div>';
        h += '<div style="font-size:10.5px;opacity:.65;line-height:1.6">' +
          'खेत का NDVI: Sentinel-2 (10 मी, हाल का), जिला औसत: ' + dNdvi.source + ' (250 मी/coarser)। ' +
          '<b>दोनों अलग उपग्रह/समय-अवधि से हैं -- सीधे तुलना सांकेतिक है, बिल्कुल सटीक नहीं।</b>' +
          '<br><span style="opacity:.8">Field NDVI: Sentinel-2 (10 m, recent). District average: ' + dNdvi.source + '. ' +
          '<b>Different satellite family and time window -- comparison is indicative, not exact.</b></span></div>';
      }
    })();

    // 5. SALAH -- via existing Kisan Sahayak chat, fed the real numbers above
    h += '<div class="section-header" style="padding:0"><div class="section-title" style="font-size:12px">5. सलाह / Advice</div></div>';
    h += '<div style="padding:8px 0 12px"><button onclick="window.VindhyaMeraKhet.askAdvice()" style="padding:8px 16px;border:none;background:var(--cyan);color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700"><i class="fa fa-comment-dots"></i> किसान सहायक से सलाह लें / Ask Kisan Sahayak</button>' +
      '<div style="font-size:10.5px;opacity:.6;margin-top:6px">ओपर दिखे सभी असली आंकड़े मॉडल को भेजे जाएंगे, और जवाब हर स्रोत को बताएगा (नंबर मॉडल से नहीं लिखे जाएंगे)। / The real numbers above will be sent to the model; its reply cites its sources (numbers are never model-generated).</div></div>';

    // Downloads
    h += mkDownloadSectionHtml();

    // Ground truth
    h += mkGroundTruthHtml();

    h += '</div>';
    box.innerHTML = h;
    mkWireGroundTruthForm(res);

    // KISAN_DASHBOARD hook (kisan_dashboard.js) -- fires on every mkRender
    // call (initial synchronous render + each async arrival of
    // analyze/soil/climate/districtNdvi below), so the full dashboard view
    // stays live-synced with zero polling of its own. No-op if that file
    // hasn't loaded (kept a plain existence check, not a hard dependency --
    // this file must keep working standalone per its own header).
    if (window.VindhyaKisanDashboard && typeof window.VindhyaKisanDashboard.update === 'function') {
      try { window.VindhyaKisanDashboard.update(res); } catch (e) { console.warn('[mera_khet] kisan_dashboard update hook', e); }
    }
  }

  // ------------------------------------------------------------------
  // A1b DOWNLOADS: GeoJSON, KML, PNG, SHP (single polygon only -- see
  // docs/MERA_KHET_BENCHMARK.json for why bulk SHP is unsafe but a single
  // farmer polygon is fine), GeoTIFF (honest "coming soon").
  // ------------------------------------------------------------------
  function mkDownloadSectionHtml() {
    return '<div class="section-header" style="padding:0;margin-top:14px"><div class="section-title" style="font-size:12px">डाउनलोड / Download</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0 12px">' +
      '<button onclick="window.VindhyaMeraKhet.downloadGeoJSON()" class="mk-dl-btn"><i class="fa fa-file-code"></i> GeoJSON</button>' +
      '<button onclick="window.VindhyaMeraKhet.downloadKML()" class="mk-dl-btn"><i class="fa fa-earth-asia"></i> KML</button>' +
      '<button onclick="window.VindhyaMeraKhet.exportPNG()" class="mk-dl-btn"><i class="fa fa-camera"></i> PNG</button>' +
      '<button onclick="window.VindhyaMeraKhet.downloadSHP()" class="mk-dl-btn"><i class="fa fa-draw-polygon"></i> SHP (zip)</button>' +
      '<button disabled title="GEE से async export -- 2-5 मिनट लगते हैं, और इस sandbox के GEE service account से यह अभी fail होता है (देखें docs/MERA_KHET_BENCHMARK.json) -- turant nahi milega" class="mk-dl-btn" style="opacity:.5;cursor:not-allowed"><i class="fa fa-layer-group"></i> GeoTIFF — जल्द आ रहा है / coming soon</button>' +
      '</div>' +
      '<style>.mk-dl-btn{padding:7px 13px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);border-radius:6px;cursor:pointer;font-size:11.5px;font-weight:600}.mk-dl-btn:hover{border-color:var(--cyan)}.mk-dl-btn:disabled{cursor:not-allowed}</style>';
  }

  function mkFieldGeoJSON(res) {
    var ring = res.ring.concat([res.ring[0]]);
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          area_ha: +res.area_ha.toFixed(3), perimeter_km: +res.perimeter_km.toFixed(4),
          state: res.state_name || null, district: res.district_name || null,
          soil_moisture_sm_surface: res.soil && res.soil.district ? res.soil.district.sm_surface_mean : null,
          annual_rain_mm: res.climate ? (res.climate.annual_rain_mm_mean != null ? res.climate.annual_rain_mm_mean : res.climate.annual_rain_mm) : null,
          drawn_at: new Date().toISOString(), source: 'Farmer-drawn polygon, VINDHYA Climate Portal Mera Khet'
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
      }]
    };
  }

  function mkReadmeText(res, formatLabel) {
    var lines = [
      'VINDHYA Climate Portal -- Mera Khet -- ' + formatLabel + ' export',
      '',
      'Area: ' + fmt(res.area_ha, 3) + ' ha (' + fmt(res.area_km2, 4) + ' km2)',
      'Perimeter: ' + fmt(res.perimeter_km, 4) + ' km',
      'District: ' + (res.district_name || 'not resolved') + ', ' + (res.state_name || ''),
      '',
      'Boundaries: Survey of India (via National Water Data Portal), used only to resolve which',
      '  district this field falls in -- the field polygon itself is drawn by the farmer, not sourced',
      '  from any cadastral/khasra record.',
      'Soil moisture: NASA SMAP L4, via Google Earth Engine, ~9 km resolution, district/grid-cell value.',
      'Climate/rainfall: ERA5-Land (~9-11 km) + CHIRPS (~5.5 km), or IMD (~5.5 km) for the 5 original',
      '  MP districts -- via Google Earth Engine / IMD gridded data, district/grid-cell value.',
      'CRS: EPSG:4326',
      'Resolution: field polygon is exact (farmer-drawn); soil moisture/climate values attached are',
      '  district/grid-cell values, NOT this field\'s own measurement -- see the panel disclaimer.',
      '',
      'Generated: ' + new Date().toISOString(),
      '',
      'Indicative, not for legal or cadastral use.',
      'सांकेतिक, कानूनी/भू-अभिलेख उपयोग हेतु नहीं।'
    ];
    return lines.join('\n');
  }

  function mkDownloadBlob(content, filename, mime) {
    var blob = (content instanceof Blob) ? content : new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadScriptOnce(src, globalCheck) {
    if (globalCheck()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { globalCheck() ? resolve() : reject(new Error(src + ' loaded but expected global missing')); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadJSZip() { return loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', function () { return typeof window.JSZip !== 'undefined'; }); }
  function loadShpWrite() { return loadScriptOnce('https://unpkg.com/@mapbox/shp-write@0.3.4/shpwrite.js', function () { return typeof window.shpwrite !== 'undefined'; }); }

  function zipWithReadme(files, readmeText, outName) {
    return loadJSZip().then(function () {
      var zip = new window.JSZip();
      Object.keys(files).forEach(function (name) { zip.file(name, files[name]); });
      zip.file('readme.txt', readmeText);
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) { mkDownloadBlob(blob, outName, 'application/zip'); });
  }

  function downloadGeoJSON() {
    if (!lastResult) return;
    var gj = mkFieldGeoJSON(lastResult);
    zipWithReadme({ 'mera_khet.geojson': JSON.stringify(gj, null, 1) }, mkReadmeText(lastResult, 'GeoJSON'), 'mera_khet_geojson.zip')
      .catch(function () { mkDownloadBlob(JSON.stringify(gj, null, 1), 'mera_khet.geojson', 'application/geo+json'); mkStatus('readme.txt जोड़ने वाला zip नहीं बन सका (नेटवर्क) -- फ़ाइल सीधे डाउनलोड हो गयी।'); });
  }

  function ringToKmlCoords(ring) {
    return ring.concat([ring[0]]).map(function (p) { return p[0] + ',' + p[1] + ',0'; }).join(' ');
  }
  function mkFieldKML(res) {
    var name = 'Mera Khet -- ' + (res.district_name || 'field') + ' (' + fmt(res.area_ha, 2) + ' ha)';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n' +
      '<name>' + name + '</name>\n' +
      '<Placemark>\n<name>' + name + '</name>\n' +
      '<description>Area: ' + fmt(res.area_ha, 3) + ' ha, Perimeter: ' + fmt(res.perimeter_km, 4) +
      ' km. Farmer-drawn polygon, VINDHYA Climate Portal Mera Khet. CRS EPSG:4326. Indicative, not for legal or cadastral use.</description>\n' +
      '<Style><LineStyle><color>ff2d8f5c</color><width>2</width></LineStyle><PolyStyle><color>4d2d8f5c</color></PolyStyle></Style>\n' +
      '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + ringToKmlCoords(res.ring) + '</coordinates></LinearRing></outerBoundaryIs></Polygon>\n' +
      '</Placemark>\n</Document></kml>';
  }
  function downloadKML() {
    if (!lastResult) return;
    var kml = mkFieldKML(lastResult);
    zipWithReadme({ 'mera_khet.kml': kml }, mkReadmeText(lastResult, 'KML'), 'mera_khet_kml.zip')
      .catch(function () { mkDownloadBlob(kml, 'mera_khet.kml', 'application/vnd.google-earth.kml+xml'); });
  }

  // SHP: single polygon only, per docs/MERA_KHET_BENCHMARK.json (bulk
  // shp-write silently drops features at scale; one feature is the exact
  // regime that benchmark found working). CRS EPSG:4326, .prj included --
  // shp-write's default .prj for unprojected WGS84 output.
  function downloadSHP() {
    if (!lastResult) return;
    mkStatus('SHP बनाया जा रहा है... / Building SHP...');
    var gj = mkFieldGeoJSON(lastResult);
    loadShpWrite().then(function () {
      var opts = { outputType: 'blob', compression: 'DEFLATE', types: { polygon: 'mera_khet' } };
      var result = window.shpwrite.zip(gj, opts);
      return Promise.resolve(result);
    }).then(function (zipResult) {
      return loadJSZip().then(function () {
        var loadP;
        if (zipResult instanceof Blob) loadP = window.JSZip.loadAsync(zipResult);
        else if (typeof zipResult === 'string') loadP = window.JSZip.loadAsync(zipResult, { base64: true });
        else throw new Error('unexpected shp-write output type');
        return loadP;
      });
    }).then(function (innerZip) {
      var outZip = new window.JSZip();
      var names = Object.keys(innerZip.files);
      return Promise.all(names.map(function (n) {
        return innerZip.files[n].async('uint8array').then(function (data) { outZip.file(n, data); });
      })).then(function () {
        outZip.file('readme.txt', mkReadmeText(lastResult, 'Shapefile (EPSG:4326)'));
        return outZip.generateAsync({ type: 'blob' });
      });
    }).then(function (blob) {
      mkDownloadBlob(blob, 'mera_khet_shp.zip', 'application/zip');
      mkStatus('');
    }).catch(function (err) {
      console.warn('[mera_khet] SHP export failed:', err);
      mkStatus('SHP निर्यात विफल -- इंटरनेट जांचें। / SHP export failed -- check your connection and try again. (' + err.message + ')');
    });
  }

  function mkSetDownloadEnabled(enabled) {
    document.querySelectorAll('.mk-dl-btn').forEach(function (b) {
      if (b.hasAttribute('data-always-disabled')) return;
      b.disabled = !enabled;
    });
  }

  // ------------------------------------------------------------------
  // A2 GROUND TRUTH: reuses the existing kisan_upload_worker.js /submit
  // endpoint and D1 schema (extended additively with an optional
  // `geometry` field -- see cloudflare/kisan_upload_schema_002_geometry.sql).
  // ------------------------------------------------------------------
  // Both Workers deployed 2026-08-13 (cloudflare/wrangler_kisan_upload.toml,
  // cloudflare/wrangler_mera_khet.toml). MK_ANALYZE_URL is safe to call
  // unconditionally -- it returns an honest 501 until GEE_BACKEND_URL is
  // configured server-side (see cloudflare/mera_khet_worker.js's header).
  // ------------------------------------------------------------------
  var MK_SUBMIT_URL = 'https://vindhya-kisan-upload.vindhyaresearch25.workers.dev/submit';
  var MK_ANALYZE_URL = 'https://vindhya-mera-khet.vindhyaresearch25.workers.dev/analyze';
  var cropListPromise = null;
  function loadCropList() {
    if (cropListPromise) return cropListPromise;
    cropListPromise = fetchWithTimeout('data/crop_list.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return cropListPromise;
  }

  function mkGroundTruthHtml() {
    return '<div class="section-header" style="padding:0;margin-top:14px"><div class="section-title" style="font-size:12px">ग्राउंड ट्रूथ (वैकल्पिक) / Ground truth (optional)</div></div>' +
      '<div style="padding:8px 10px;background:rgba(26,138,158,.06);border-radius:6px;font-size:11px;line-height:1.7;margin-bottom:8px">' +
      'इस खेत में अभी कौन सी फसल है? यह सार्वजनिक शोध डेटासेट में जाएगा (नाम/फोन नहीं मांगा जाता)।' +
      '<br><span style="opacity:.7">What crop is on this field right now? Goes into a public research dataset -- no name/phone asked.</span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">' +
      '<div><label style="font-size:10px;opacity:.7;display:block">फसल / Crop</label><select id="mk-crop" style="padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;min-width:140px"><option value="">-- चुनें / Select --</option></select></div>' +
      '<div><label style="font-size:10px;opacity:.7;display:block">मौसम / Season</label><select id="mk-season" style="padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px"><option value="">--</option><option value="kharif">खरीफ (Kharif)</option><option value="rabi">रबी (Rabi)</option><option value="zayad">ज़ायद (Zayad)</option></select></div>' +
      '</div>' +
      '<label style="display:flex;gap:6px;align-items:flex-start;font-size:10.5px;opacity:.8;margin-bottom:8px"><input type="checkbox" id="mk-consent" style="margin-top:2px"><span>मैं सहमत हूं कि मेरी दी गई जानकारी (बिना नाम/फोन) सार्वजनिक शोध डेटासेट में उपयोग हो। खेत की सीमा बोर्डिनेट (≈100म तक गोल) होगा।<br><span style="opacity:.7">I agree my info (no name/phone) goes into a public research dataset; the field boundary is rounded to ~100m before publication.</span></span></label>' +
      '<button id="mk-submit-gt" disabled style="padding:8px 16px;border:none;background:var(--green);color:#fff;border-radius:6px;cursor:not-allowed;opacity:.5;font-size:12px;font-weight:700">जमा करें / Submit</button>' +
      '<div id="mk-gt-msg" style="font-size:11px;margin-top:6px"></div>';
  }

  function mkWireGroundTruthForm(res) {
    loadCropList().then(function (d) {
      var sel = el('mk-crop');
      if (!sel) return;
      (d && d.crops || []).forEach(function (c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
      });
      var other = document.createElement('option'); other.value = 'अन्य / Other'; other.textContent = 'अन्य / Other';
      sel.appendChild(other);
    });
    function updateEnabled() {
      var crop = el('mk-crop'), season = el('mk-season'), consent = el('mk-consent'), btn = el('mk-submit-gt');
      if (!btn) return;
      var ok = crop && crop.value && season && season.value && consent && consent.checked;
      btn.disabled = !ok;
      btn.style.opacity = ok ? '1' : '.5';
      btn.style.cursor = ok ? 'pointer' : 'not-allowed';
    }
    ['mk-crop', 'mk-season', 'mk-consent'].forEach(function (id) { var e = el(id); if (e) e.addEventListener('change', updateEnabled); });
    var submitBtn = el('mk-submit-gt');
    if (submitBtn) submitBtn.onclick = function () { mkSubmitGroundTruth(res); };
  }

  function round3(x) { return Math.round(x * 1000) / 1000; }

  function mkSubmitGroundTruth(res) {
    var msg = el('mk-gt-msg'), btn = el('mk-submit-gt');
    if (!res || !res.centroid) return;
    var payload = {
      crop: el('mk-crop').value, season: el('mk-season').value,
      lat: round3(res.centroid[1]), lon: round3(res.centroid[0]),
      area_ha: +res.area_ha.toFixed(2),
      consent: el('mk-consent').checked,
      // Rounded (~100m, DPDP privacy rule) polygon ring -- the extra field
      // kisan_upload_worker.js/schema were extended to accept additively;
      // kisan_upload.html's plain point-only submissions are unaffected.
      geometry: res.ring.map(function (p) { return [round3(p[0]), round3(p[1])]; })
    };
    if (btn) { btn.disabled = true; }
    if (msg) { msg.textContent = 'भेजा जा रहा है... / Submitting...'; msg.style.color = ''; }
    fetchWithTimeout(MK_SUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res2) {
        if (res2.ok && res2.data.ok) {
          if (msg) { msg.textContent = 'धन्यवाद! प्रविष्टि सुरक्षित हो गई। / Thank you, saved.'; msg.style.color = 'var(--green)'; }
        } else {
          if (msg) { msg.textContent = 'त्रुटि / Error: ' + (res2.data && res2.data.error || 'unknown'); msg.style.color = 'var(--red)'; }
        }
      })
      .catch(function (err) {
        // Worker not deployed yet (placeholder URL) is the expected state
        // this session -- fail honestly, never claim success.
        if (msg) { msg.textContent = 'नेटवर्क/सर्वर त्रुटि -- अपलोड Worker अभी डिप्लॉय नहीं हुआ हो सकता। / Network/server error -- the upload Worker may not be deployed yet. (' + err.message + ')'; msg.style.color = 'var(--red)'; }
      })
      .finally(function () { if (btn) btn.disabled = false; });
  }

  // ------------------------------------------------------------------
  // 5. Advice via existing Kisan Sahayak chat, fed the real numbers we
  // already fetched -- no separate model call is written here.
  // ------------------------------------------------------------------
  function askAdvice() {
    var res = lastResult;
    if (!res) return;
    // Same pattern as index.html's own askChatAboutCadastral().
    if (typeof chatOpen !== 'undefined' && !chatOpen && typeof toggleChat === 'function') toggleChat();
    var input = el('chatInput');
    if (!input) return;
    var parts = ['Give me crop advisory for my own drawn field.',
      'Area: ' + fmt(res.area_ha, 2) + ' ha, in ' + (res.district_name || 'an unresolved district') + ', ' + (res.state_name || '') + '.'];
    if (res.soil && res.soil.district) parts.push('District/grid soil moisture (SMAP, ~9km, not field-specific): ' + fmt(res.soil.district.sm_surface_mean, 3) + ' m3/m3.');
    if (res.analyze && res.analyze.available && res.analyze.field_wetness_index_relative != null) {
      parts.push('Field wetness index (relative, NOT m3/m3): field Sentinel-1 VV backscatter is ' + fmt(res.analyze.field_wetness_index_relative, 1) + '% vs. the containing district, same satellite pass -- this reflects radar backscatter (moisture + vegetation + roughness combined), not an absolute moisture measurement.');
    }
    if (res.climate) {
      var rain = res.climate.annual_rain_mm_mean != null ? res.climate.annual_rain_mm_mean : res.climate.annual_rain_mm;
      parts.push('District annual rainfall (2000-2024 mean, not field-specific): ' + fmt(rain, 0) + ' mm.');
    }
    parts.push('Base your advice only on the data above and whatever you can look up for this place; cite your sources.');
    if (typeof sendChat === 'function') {
      input.value = parts.join(' ');
      sendChat();
    }
  }

  // ------------------------------------------------------------------
  // Sidebar nav item + bottom-panel tab/pane -- injected at runtime (same
  // pattern geoai_professional.js already uses for its own AOI/Live
  // Weather tabs), so index.html itself needs only a <script> tag.
  // ------------------------------------------------------------------
  function addNavItem() {
    if (el('mk-nav-item')) return;
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'mk-nav-item';
    item.innerHTML = '<span class="nav-icon"><i class="fa fa-seedling"></i></span><span class="nav-label">मेरा खेत / Mera Khet</span><span class="nav-badge">NEW</span>';
    item.onclick = function () {
      document.querySelectorAll('.nav-item').forEach(function (i) { i.classList.remove('active'); });
      item.classList.add('active');
      var tab = el('mk-tab');
      if (tab) tab.click();
    };
    nav.appendChild(item);
  }

  function paneHost() {
    var p = document.querySelector('.btm-pane');
    return p ? p.parentNode : null;
  }
  function addTabAndPane() {
    var host = paneHost();
    var tabsHost = document.querySelector('.btm-tab');
    tabsHost = tabsHost ? tabsHost.parentNode : null;
    if (!host || !tabsHost || el('pane-merakhet')) return;

    var tab = document.createElement('div');
    tab.className = 'btm-tab'; tab.id = 'mk-tab';
    tab.innerHTML = '<i class="fa fa-seedling"></i>Mera Khet';
    tab.onclick = function () { if (typeof switchTab === 'function') switchTab(tab, 'merakhet'); };
    tabsHost.appendChild(tab);

    var pane = document.createElement('div');
    pane.className = 'btm-pane'; pane.id = 'pane-merakhet';
    pane.innerHTML =
      '<button class="mk-modal-close" onclick="typeof closeMeraKhetModal===\'function\' && closeMeraKhetModal()" title="Close / बंद करें">&times;</button>' +
      '<div style="display:flex;gap:8px;align-items:center;padding:10px 14px 0;flex-wrap:wrap">' +
      '<button id="mk-btn-draw" style="padding:6px 14px;border:1px solid var(--green);background:var(--green);color:#fff;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">खेत खींचें / Draw field</button>' +
      '<button id="mk-btn-finish" style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);border-radius:5px;cursor:pointer;font-size:12px">पूरा करें / Finish</button>' +
      '<button id="mk-btn-clear" style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);border-radius:5px;cursor:pointer;font-size:12px">साफ़ करें / Clear</button>' +
      '<span id="mk-status" style="font-size:11px;opacity:.7;flex-basis:100%"></span></div>' +
      '<div id="mk-result" style="overflow-y:auto;flex:1">' + mkEmptyHtml() + '</div>';
    host.appendChild(pane);

    el('mk-btn-draw').onclick = startDrawMK;
    el('mk-btn-finish').onclick = finishDrawMK;
    el('mk-btn-clear').onclick = clearFieldMK;
  }

  function wireMapClick() {
    var map = window.leafletMap;
    if (!map || map._mkClickWired) return;
    map._mkClickWired = true;
    map.on('click', onMapClickMK);
    map.on('dblclick', function () { if (drawing) finishDrawMK(); });
  }

  // Small hook into the disabled Cadastral pane (B8: "Ab Mera Khet isi ki
  // jagah kaam karega -- panel me link do").
  function addCadastralLink() {
    var pane = el('pane-cadastral');
    if (!pane || el('mk-cad-link')) return;
    var box = document.createElement('div');
    box.id = 'mk-cad-link';
    box.style.cssText = 'margin:10px 14px;padding:10px 12px;background:rgba(45,143,92,.08);border:1px solid rgba(45,143,92,.3);border-radius:8px;font-size:12px';
    box.innerHTML = 'खसरा रिकॉर्ड की जगह अपना खेत खुद खींचिए -- <button onclick="window.VindhyaMeraKhet.open()" style="border:none;background:var(--green);color:#fff;padding:5px 11px;border-radius:5px;cursor:pointer;font-size:11.5px;font-weight:700">मेरा खेत खोलें / Open Mera Khet</button>' +
      '<div style="opacity:.7;margin-top:4px">Instead of official khasra records, draw your own field boundary -- Mera Khet.</div>';
    pane.insertBefore(box, pane.firstChild.nextSibling);
  }

  function openMeraKhet() {
    var item = el('mk-nav-item');
    if (item) item.click();
  }

  // Click-outside-to-close for the modal treatment (the backdrop itself
  // is a CSS ::before pseudo-element -- it can't carry its own listener --
  // so this checks on every document click while the modal is open).
  function wireModalOutsideClick() {
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('mk-modal-open')) return;
      if (e.target.closest('#pane-merakhet') || e.target.closest('#mk-nav-item') || e.target.closest('#mk-tab')) return;
      if (typeof closeMeraKhetModal === 'function') closeMeraKhetModal();
    }, true);
  }

  function boot() {
    if (!window.L || !window.leafletMap) { setTimeout(boot, 700); return; }
    try { addNavItem(); } catch (e) { console.warn('[mera_khet] nav', e); }
    try { addTabAndPane(); } catch (e) { console.warn('[mera_khet] pane', e); }
    try { wireMapClick(); } catch (e) { console.warn('[mera_khet] map click', e); }
    try { addCadastralLink(); } catch (e) { console.warn('[mera_khet] cadastral link', e); }
    try { wireModalOutsideClick(); } catch (e) { console.warn('[mera_khet] outside-click', e); }
    console.log('[mera_khet] loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 950); });
  } else {
    setTimeout(boot, 950);
  }

  // PNG export (Phase 5.3, crop-to-selection rewrite 2026-08-13): passes
  // the drawn polygon's own real bounds/area/feature to exportMapPNG()
  // instead of letting it fall back to the Location Selector's current
  // boundary (which would be wrong here -- the farmer drew a field, not a
  // district). ring is [[lon,lat],...]; L.latLngBounds wants [lat,lon].
  function exportPNG() {
    if (typeof exportMapPNG !== 'function') return;
    if (!lastResult || !lastResult.ring || !lastResult.ring.length) { exportMapPNG(); return; }
    var latlngs = lastResult.ring.map(function (c) { return [c[1], c[0]]; });
    var bounds = (typeof L !== 'undefined') ? L.latLngBounds(latlngs) : null;
    exportMapPNG({
      bounds: bounds,
      areaHa: lastResult.area_ha,
      feature: mkFieldGeoJSON(lastResult),
      title: 'मेरा खेत / My Field' + (lastResult.district_name ? ' — ' + lastResult.district_name + ', ' + lastResult.state_name : ''),
      source: 'Farmer-drawn field boundary (Mera Khet) | Survey of India boundaries | ' + (lastResult.climateSource || 'ERA5-Land+CHIRPS/IMD'),
    });
  }

  window.VindhyaMeraKhet = {
    open: openMeraKhet, askAdvice: askAdvice, exportPNG: exportPNG,
    downloadGeoJSON: downloadGeoJSON, downloadKML: downloadKML, downloadSHP: downloadSHP
  };
})();

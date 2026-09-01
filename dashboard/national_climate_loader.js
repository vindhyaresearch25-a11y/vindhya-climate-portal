/*
 * national_climate_loader.js -- populates the right-panel metric cards
 * and the Historical Indices panel for the ~728 non-MP districts that
 * scripts/08_gee_national_climate.py has computed so far
 * (dashboard/data/climate/<state_slug>/<district_slug>.json).
 *
 * mp_climate_loader.js already owns the 5 real IMD districts (Bhopal,
 * Indore, Jabalpur, Rewa, Sidhi) and their monthly/annual charts; this
 * file explicitly skips any district MP_DISTRICTS already recognises,
 * and does NOT attempt to fill the chart panels below the map -- the
 * GEE output only has 2000-2024 AGGREGATE indices, not per-month or
 * per-year time series, so those charts correctly stay in their
 * existing empty state for these districts rather than showing
 * something invented. Source is ERA5-Land (ECMWF) + CHIRPS (UCSB) via
 * Google Earth Engine -- a genuinely different real dataset from the 5
 * MP districts' IMD data, always labelled as such here, never merged
 * or presented as if it were IMD-derived.
 */
(function () {
  'use strict';

  var manifestPromise = null;
  var lookup = null; // districtSlug -> {stateSlug, districtSlug}
  var cache = {};    // "stateSlug/districtSlug" -> fetched file

  // 30s timeout on every fetch (STANDING ORDERS #5) -- a slow/hung request
  // degrades to the existing .catch() fallback instead of hanging the page.
  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

  function slugify(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function loadManifest() {
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetchWithTimeout('data/climate_manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        lookup = {};
        if (m && m.gee_era5_chirps && Array.isArray(m.gee_era5_chirps.districts)) {
          m.gee_era5_chirps.districts.forEach(function (entry) {
            var parts = entry.split('/');
            if (parts.length === 2) {
              // District slugs are unique across the whole country in the
              // manifest as computed so far (checked -- zero collisions);
              // if a future state's district ever collides with another
              // state's, this lookup would need state-aware disambiguation.
              lookup[parts[1]] = { stateSlug: parts[0], districtSlug: parts[1] };
            }
          });
        }
        return lookup;
      })
      .catch(function () { lookup = {}; return lookup; });
    return manifestPromise;
  }

  function fmt(v, d) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d);
  }
  function setTxt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function setBar(id, pct) { var e = document.getElementById(id); if (e) e.style.width = pct + '%'; }

  function isMpRealDistrict(districtName) {
    var key = slugify(districtName);
    return typeof MP_DISTRICTS !== 'undefined' && !!MP_DISTRICTS[key] &&
      ['bhopal', 'indore', 'jabalpur', 'rewa', 'sidhi'].indexOf(key) >= 0;
  }

  // Diu and Lakshadweep are the only 2 of 733 districts genuinely absent
  // from climate_manifest.json -- scripts/08_gee_national_climate.py's own
  // log shows why: "[WARN] too little data returned (0 rows), skipped --
  // not writing a partial/fabricated result". Both are small islands
  // smaller than a single ERA5-Land/CHIRPS grid cell (~9-11 km), so
  // reduceRegion() over their polygon returns nothing real to average.
  // This is a genuinely different reason than "not computed yet" (every
  // other missing district), so it gets its own honest message rather
  // than the generic "Not available" (PENDING.md item 8).
  var TOO_SMALL_FOR_GRID = { diu: true, lakshadweep_district: true, lakshadweep: true };

  function tooSmallForGridNote(districtName) {
    return districtName + ' is smaller than one ERA5-Land/CHIRPS satellite grid cell (~9-11 km) -- '
      + 'the district-wide average this pipeline computes for every other district is not meaningful here, '
      + 'so no value is shown rather than an unreliable one. See scripts/08_gee_national_climate.py\'s run log.';
  }

  // AUDIT_FIX_PROMPT.md item 0C part 2: these ~726 GEE districts have no
  // block/village-level source at all -- once a block/village is picked
  // under one of them, applyGeeMetrics() itself isn't re-run (nothing here
  // hooks onBlockChange/onVillageChange the way MP's real 5 districts do
  // via national_selector.js's restoreDistrictMetricsIfReal()), so the
  // labels below would otherwise silently keep reading "district-level"
  // even after the breadcrumb has moved to a block/village. lastBase caches
  // each label's real (district-level) text so reapplyLevelSuffix() can
  // recompute just the honesty suffix on a block/village change without
  // needing to refetch anything.
  var lastBase = {};
  var lastDistrictName = null;
  function setTxtLvl(id, base) {
    lastBase[id] = base;
    var suffix = (typeof window.climateLevelSuffix === 'function') ? window.climateLevelSuffix(false) : '';
    setTxt(id, base + suffix);
  }
  // Only reapplies if the selection is STILL the same GEE district that
  // last actually rendered these labels (isMpRealDistrict / a since-changed
  // district would mean lastBase belongs to a different place entirely --
  // reapplying it then would silently show a stale district's numbers
  // under the wrong breadcrumb, exactly the bug this whole feature exists
  // to remove).
  function reapplyLevelSuffix() {
    var sel = (typeof window.getCurrentSelection === 'function') ? window.getCurrentSelection() : {};
    if (!sel.district || !lastDistrictName) return;
    if (slugify(sel.district) !== slugify(lastDistrictName)) return;
    if (isMpRealDistrict(sel.district)) return;
    var suffix = (typeof window.climateLevelSuffix === 'function') ? window.climateLevelSuffix(false) : '';
    Object.keys(lastBase).forEach(function (id) { setTxt(id, lastBase[id] + suffix); });
  }

  function applyGeeMetrics(file, districtName) {
    var idx = file.indices || {};
    var meta = file.metadata || {};
    lastDistrictName = districtName;

    var droughtVal = idx.drought_probability_pct != null ? idx.drought_probability_pct : null;
    setTxt('m-drought', droughtVal != null ? Number(droughtVal).toFixed(1) + '%' : 'Not available');
    setBar('bar-drought', Math.min(100, Math.max(0, droughtVal || 0)));
    // item 15e (2026-08-15): was static "Select a district" text that never updated
    setTxtLvl('drought-trend', droughtVal != null ? (districtName || '') + ' · ' + (meta.years || '2000–2024') : (districtName || ''));

    // NDVI requires DiCRA/MODIS district series, only built for MP so far.
    setTxt('m-ndvi', 'Not available');
    setBar('bar-ndvi', 0);

    var hwDays = idx.heatwave_days != null ? idx.heatwave_days : null;
    var hwSevereDays = idx.severe_heatwave_days != null ? idx.severe_heatwave_days : null;
    var navBadgeHeat = document.getElementById('nav-badge-heat');
    if (hwDays != null) {
      var heatLabel = (hwSevereDays != null && hwSevereDays >= 2) ? 'EXTREME'
        : hwDays >= 8 ? 'HIGH' : hwDays >= 2 ? 'MODERATE' : 'LOW';
      setTxt('m-heat', heatLabel);
      setBar('bar-heat', Math.min(100, Math.max(0, Math.round((hwDays / 20) * 100))));
      setTxtLvl('heat-detail', hwDays.toFixed(1) + ' heatwave d/yr, 2000–2024 mean ' + (districtName || ''));
      if (navBadgeHeat) navBadgeHeat.style.display = (heatLabel === 'HIGH' || heatLabel === 'EXTREME') ? '' : 'none';
    } else {
      setTxt('m-heat', 'Not available');
      setBar('bar-heat', 0);
      setTxtLvl('heat-detail', districtName || '');
      if (navBadgeHeat) navBadgeHeat.style.display = 'none';
    }

    // GEE output has only a 2000-2024 mean, not a per-year series, so a
    // departure-from-mean (which the 5 IMD districts show) can't be
    // computed honestly here -- show the real mean itself instead, with
    // a caption that says exactly that rather than implying a departure.
    var rainMean = idx.annual_rain_mm != null ? idx.annual_rain_mm : null;
    if (rainMean != null) {
      setTxt('m-rain', Math.round(rainMean) + ' mm');
      setTxtLvl('m-rain-trend', (districtName || '') + ' 2000–2024 mean (ERA5-Land/CHIRPS)');
    } else {
      setTxt('m-rain', 'Not available');
      setTxtLvl('m-rain-trend', districtName || '');
    }

    setTxt('m-soil', 'Not available'); setBar('bar-soil', 0);
    // Default reset -- soil_moisture_loader.js and groundwater_loader.js
    // (both loaded after this file, both wrap onDistrictChange) overwrite
    // these with real SMAP / CGWB-via-NWDP values right after this render,
    // whenever real coverage exists for the selected district.
    setTxt('m-gw', 'Not available'); setBar('bar-gw', 0);

    if (droughtVal != null) {
      var cs = Math.min(100, Math.max(0, Math.round(droughtVal)));
      setTxt('m-crop', cs + '% (indicative)'); setBar('bar-crop', cs);
      setTxt('m-crop-trend', 'Derived from drought probability');
    } else {
      setTxt('m-crop', 'Not available'); setBar('bar-crop', 0);
      setTxt('m-crop-trend', 'Select a district');
    }

    // adv-title-0/adv-body-0 writes removed 2026-08-14 -- the right-panel
    // Farmer Advisory block those belonged to was deleted (owner
    // instruction; duplicated the bottom Agriculture tab's own advisory
    // section).

    renderHistoricalPanel(idx, meta, districtName);
  }

  function renderHistoricalPanel(idx, meta, districtName) {
    var host = document.getElementById('historical-indices-panel');
    if (!host) return;
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-chart-line" style="color:var(--cyan);font-size:0.7rem"></i>'
      + '<div class="section-title">HISTORICAL INDICES 2000–2024 (' + (districtName || '') + ') '
      + '<span style="color:var(--text-dim);font-weight:500;font-size:0.6rem;letter-spacing:0.3px">ERA5-Land/CHIRPS via GEE, not IMD</span></div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card"><div class="metric-label">HEATWAVE DAYS/YR</div><div class="metric-value cyan">' + fmt(idx.heatwave_days, 1) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">SEVERE HW DAYS</div><div class="metric-value" style="color:var(--red)">' + fmt(idx.severe_heatwave_days, 1) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">MEAN SUMMER TMAX</div><div class="metric-value" style="color:var(--orange)">' + fmt(idx.mean_summer_tmax, 1) + '°C</div></div>'
      + '  <div class="metric-card"><div class="metric-label">MAX SUMMER TMAX</div><div class="metric-value" style="color:var(--red)">' + fmt(idx.max_summer_tmax, 1) + '°C</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DROUGHT MONTHS/YR</div><div class="metric-value" style="color:var(--orange)">' + fmt(idx.drought_months, 1) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DROUGHT PROB %</div><div class="metric-value" style="color:var(--orange)">' + fmt(idx.drought_probability_pct, 1) + '%</div></div>'
      + '  <div class="metric-card"><div class="metric-label">SPI-12</div><div class="metric-value" style="color:var(--blue)">' + fmt(idx.spi_12, 2) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">ANNUAL RAIN</div><div class="metric-value" style="color:var(--blue)">' + fmt(idx.annual_rain_mm, 0) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">R95p / YR</div><div class="metric-value" style="color:var(--blue)">' + fmt(idx.r95p_mm, 1) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx1day</div><div class="metric-value" style="color:var(--blue)">' + fmt(idx.rx1day_mm, 1) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx5day</div><div class="metric-value" style="color:var(--blue)">' + fmt(idx.rx5day_mm, 1) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">CDD</div><div class="metric-value" style="color:var(--orange)">' + fmt(idx.cdd, 1) + ' d</div></div>'
      + '</div>'
      + '<div style="font-size:0.65rem;font-weight:600;color:var(--text-dim);padding:0 0.75rem 0.5rem">'
      + 'Source: ERA5-Land + CHIRPS via Google Earth Engine, ' + (meta.years || '2000–2024')
      + ' — not IMD. See Data Sources.</div>';
  }

  function handleDistrictChange(districtName) {
    if (!districtName || isMpRealDistrict(districtName)) return; // mp_climate_loader.js owns these
    loadManifest().then(function () {
      var dslug = slugify(districtName);
      var entry = lookup[dslug];
      if (!entry) {
        if (TOO_SMALL_FOR_GRID[dslug]) setTxt('heat-detail', tooSmallForGridNote(districtName));
        return; // GEE hasn't computed this district yet (or, for Diu/Lakshadweep, genuinely can't) -- metric cards stay "Not available"
      }
      var key = entry.stateSlug + '/' + entry.districtSlug;
      if (cache[key]) { applyGeeMetrics(cache[key], districtName); return; }
      fetchWithTimeout('data/climate/' + entry.stateSlug + '/' + entry.districtSlug + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (file) {
          if (!file) return;
          cache[key] = file;
          applyGeeMetrics(file, districtName);
        })
        .catch(function () { /* leave as "Not available" */ });
    });
  }

  function boot() {
    loadManifest();
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      if (typeof originalOnDistrictChange === 'function') originalOnDistrictChange(distKey);
      handleDistrictChange(distKey);
    };
    // AUDIT_FIX_PROMPT.md item 0C part 2: a block/village pick under one of
    // these GEE districts never changes the underlying number (no
    // sub-district source exists), but the honesty suffix next to it must
    // still update the moment the breadcrumb goes deeper -- see lastBase/
    // reapplyLevelSuffix() above. Composes with whatever else already
    // wraps onBlockChange/onVillageChange (advisory_loader.js, etc.),
    // exactly like this file already does for onDistrictChange above.
    var originalOnBlockChange = window.onBlockChange;
    window.onBlockChange = function (blockName) {
      if (typeof originalOnBlockChange === 'function') originalOnBlockChange(blockName);
      reapplyLevelSuffix();
    };
    var originalOnVillageChangeGee = window.onVillageChange;
    window.onVillageChange = function (village) {
      if (typeof originalOnVillageChangeGee === 'function') originalOnVillageChangeGee(village);
      reapplyLevelSuffix();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }
})();

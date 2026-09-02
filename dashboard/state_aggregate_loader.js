/*
 * state_aggregate_loader.js -- AUDIT_FIX_PROMPT.md item 0C part 2 (owner
 * 2026-09-02): "Climate Risk Atlas / NDVI Analytics / Rainfall Monitor ka
 * data star-wise banao ... State -> District -> Block -> Village".
 *
 * Live-tested gap this fixes: selecting a STATE with no district yet
 * (e.g. Madhya Pradesh, 52 of its 55 districts already have real computed
 * climate indices) forced every metric card to "Not available" -- a
 * self-inflicted gap, not an honest one, since real per-district numbers
 * already exist one level up from this file's own reach. This module
 * renders a real MEAN across the state's own already-computed real
 * per-district files into the same two panels a single district's numbers
 * already live in (#historical-indices-panel, #national-ndvi-panel),
 * clearly labelled as a state-level aggregate of N of Total real
 * districts -- mirrors advisory_loader.js's own state-tier convention
 * (see its renderStateTier()). Never fabricates a state-specific number,
 * never substitutes a neighbouring state's data (STANDING ORDERS #6).
 *
 * Rainfall Monitor's own charts (chartRain/chartTemp/chartTrends) have no
 * honest state-level equivalent to build: GEE's per-district climate file
 * is a single 2000-2024 mean, not a month/year time series, so there is
 * nothing to average into a real trend line across N districts. Instead
 * of leaving those charts' existing "Select a district" empty-state text
 * sitting there even once a state IS selected (misleading -- something
 * WAS selected), this module points that text at the real aggregate
 * rendered here.
 *
 * District/block/village tiers are untouched by this file -- district is
 * already real (mp_climate_loader.js / national_climate_loader.js /
 * national_ndvi_loader.js), block/village honesty labelling is
 * national_selector.js's climateLevelSuffix() plus each of those loaders'
 * own reapplyLevelSuffix().
 */
(function () {
  'use strict';

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }
  function slugify(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  // Same 2 real-world alias pairs index.html's own MP_DISTRICT_NAME_ALIASES
  // documents (Hoshangabad/Narmadapuram renamed 2021, Khandwa/East Nimar
  // dual real names) -- without normalizing these, dicra_ndvi.json (keyed
  // by the old names) and data/ndvi/madhya_pradesh/*.json (keyed by the
  // newer names) look like 2 different districts and get double-counted
  // into the state mean below (live-tested: showed "53 of 52" before this).
  var NDVI_ALIAS_SLUGS = { hoshangabad: 'narmadapuram', khandwa: 'east_nimar' };
  function ndviCanonicalSlug(s) { var v = slugify(s); return NDVI_ALIAS_SLUGS[v] || v; }
  function fmt(v, d) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d); }
  function mean(vals) {
    var real = vals.filter(function (v) { return v != null && !isNaN(v); });
    if (!real.length) return null;
    return real.reduce(function (a, b) { return a + b; }, 0) / real.length;
  }
  // GEE files use one field-naming convention (idx.heatwave_days), the 5
  // IMD-real districts (mp_climate_data.json) use another (idx.heatwave_days_mean)
  // -- see national_climate_loader.js's own renderHistoricalPanel and
  // index.html's applyDistrictMetrics for the two conventions this mirrors.
  function pick(idx, geeKey, imdKey) { return idx[geeKey] != null ? idx[geeKey] : idx[imdKey]; }

  // ---------------------------------------------------------------------
  // Data loading -- manifests + per-district files, all cached
  // ---------------------------------------------------------------------
  // NOTE: keyed by "stateSlug/districtSlug" (the manifest's own natural
  // key), NOT by districtSlug alone -- this module needs "give me every
  // district IN this state", the opposite direction from
  // national_climate_loader.js's own districtSlug-only lookup (which
  // answers "which state is this district in", the right shape for ITS
  // job of resolving one already-known district name).
  var climateManifestPromise = null, climateDistrictKeys = null; // array of "stateSlug/districtSlug"
  function loadClimateManifest() {
    if (climateManifestPromise) return climateManifestPromise;
    climateManifestPromise = fetchWithTimeout('data/climate_manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        climateDistrictKeys = (m && m.gee_era5_chirps && Array.isArray(m.gee_era5_chirps.districts)) ? m.gee_era5_chirps.districts : [];
        return climateDistrictKeys;
      }).catch(function () { climateDistrictKeys = []; return climateDistrictKeys; });
    return climateManifestPromise;
  }

  // Same fix as loadClimateManifest() above: keep the raw "stateSlug/
  // districtSlug" key array so this state's own districts can be found by
  // PREFIX filter -- a districtSlug-only dict (the shape national_ndvi_loader.js
  // itself needs, for its own opposite direction lookup) can't answer "which
  // districts are in this state" at all.
  var ndviManifestPromise = null, ndviDistrictKeys = null, dicraDistrictsData = null;
  function loadNdviManifests() {
    if (ndviManifestPromise) return ndviManifestPromise;
    ndviManifestPromise = Promise.all([
      fetchWithTimeout('data/ndvi_manifest.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetchWithTimeout('data/dicra_ndvi.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      ndviDistrictKeys = (results[0] && results[0].gee_modis && Array.isArray(results[0].gee_modis.districts)) ? results[0].gee_modis.districts : [];
      dicraDistrictsData = (results[1] && results[1].districts) || {};
      return { ndviDistrictKeys: ndviDistrictKeys, dicra: dicraDistrictsData };
    }).catch(function () { ndviDistrictKeys = []; dicraDistrictsData = {}; return { ndviDistrictKeys: [], dicra: {} }; });
    return ndviManifestPromise;
  }

  var districtsIndexPromise = null, stateDistrictTotals = null;
  function loadDistrictsIndex() {
    if (districtsIndexPromise) return districtsIndexPromise;
    districtsIndexPromise = fetchWithTimeout('data/boundaries/' + 'soi/districts_index.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) {
        stateDistrictTotals = {};
        if (idx && Array.isArray(idx.districts)) {
          idx.districts.forEach(function (d) { stateDistrictTotals[d.state_name] = (stateDistrictTotals[d.state_name] || 0) + 1; });
        }
        return stateDistrictTotals;
      }).catch(function () { stateDistrictTotals = {}; return stateDistrictTotals; });
    return districtsIndexPromise;
  }

  var climateFileCache = {};
  function loadClimateFile(stateSlug, dslug) {
    var key = stateSlug + '/' + dslug;
    if (climateFileCache[key]) return Promise.resolve(climateFileCache[key]);
    return fetchWithTimeout('data/climate/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) { if (file) climateFileCache[key] = file; return file; })
      .catch(function () { return null; });
  }
  var ndviFileCache = {};
  function loadNdviFile(stateSlug, dslug) {
    var key = stateSlug + '/' + dslug;
    if (ndviFileCache[key]) return Promise.resolve(ndviFileCache[key]);
    return fetchWithTimeout('data/ndvi/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) { if (file) ndviFileCache[key] = file; return file; })
      .catch(function () { return null; });
  }

  // window._mpClimateData (mp_climate_loader.js) loads asynchronously and
  // may not be ready yet the first time a state is picked -- poll briefly
  // rather than assume it's absent forever. Never blocks the GEE districts
  // (which resolve independently) from rendering.
  function waitForMpClimateData(maxTries) {
    return new Promise(function (resolve) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (window._mpClimateData || tries > (maxTries || 20)) {
          clearInterval(iv);
          resolve(window._mpClimateData || null);
        }
      }, 250);
    });
  }

  // ---------------------------------------------------------------------
  // Owner report (2026-09, Hinglish): "Climate Metrics panel me bhi data...
  // sabhi panels me reflect nahi ho rahe" -- the top-of-page right-hand
  // Climate Metrics cards (m-drought/m-heat/m-rain/m-ndvi/m-crop) stayed
  // 'Not available' at STATE level even though this file already computes
  // a real cross-district mean and renders it into #historical-indices-panel/
  // #national-ndvi-panel (verified live -- those two panels DID show real
  // numbers, the top cards did not: two different pieces of the same page
  // silently disagreeing about whether state-level data exists). This
  // writes the same already-computed real means into those shared cards
  // too, honestly labelled as a state aggregate.
  //
  // Guarded on the selection still being this exact bare state (no district
  // picked meanwhile) -- these fetches can resolve well after the user has
  // already drilled into a district, whose own real per-district numbers
  // must never be clobbered by a slower, now-stale state-wide mean.
  function stillBareState(stateName) {
    var sel = (typeof window.getCurrentSelection === 'function') ? window.getCurrentSelection() : {};
    return sel.state === stateName && !sel.district;
  }
  function setTxt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function setBar(id, pct) { var e = document.getElementById(id); if (e) e.style.width = pct + '%'; }

  function applyStateClimateCards(stateName, rows, nTotal) {
    if (!stillBareState(stateName)) return;
    if (!rows.length) { return; } // resetClimateToNotAvailable()'s honest blank stays -- nothing real to show
    function agg(geeKey, imdKey) { return mean(rows.map(function (idx) { return pick(idx, geeKey, imdKey); })); }
    var droughtPct = agg('drought_probability_pct', 'drought_probability_pct');
    var hw = agg('heatwave_days', 'heatwave_days_mean');
    var severeHw = agg('severe_heatwave_days', 'severe_heatwave_days_mean');
    var maxTmax = agg('max_summer_tmax', 'max_summer_tmax');
    var rain = agg('annual_rain_mm', 'annual_rain_mm_mean');
    var suffix = ' · state mean, ' + rows.length + (nTotal ? ' of ' + nTotal : '') + ' real districts';

    if (droughtPct != null) {
      setTxt('m-drought', fmt(droughtPct, 1) + '%');
      setBar('bar-drought', Math.min(100, Math.max(0, droughtPct)));
      setTxt('drought-trend', stateName + suffix);
      var cs = Math.min(100, Math.max(0, Math.round(droughtPct)));
      // Routed through index.html's single setCropStress() writer
      // (2026-09-02 audit) so the card's basis line and tooltip always
      // state the formula actually used -- four call sites previously
      // wrote this card on two different scales under one label.
      if (typeof window.setCropStress === 'function') {
        window.setCropStress(cs, 'drought probability', 'drought probability percent, shown as-is');
      } else { setTxt('m-crop', cs + '% (indicative)'); setBar('bar-crop', cs); }
      setTxt('m-crop-trend', 'Derived from state-mean drought probability');
    }
    if (hw != null) {
      var heatLabel = (severeHw != null && severeHw >= 2) ? 'EXTREME' : hw >= 8 ? 'HIGH' : hw >= 2 ? 'MODERATE' : 'LOW';
      setTxt('m-heat', heatLabel);
      setBar('bar-heat', Math.min(100, Math.max(0, Math.round((hw / 20) * 100))));
      setTxt('heat-detail', fmt(hw, 1) + ' heatwave d/yr' + (maxTmax != null ? ', max Tmax ' + fmt(maxTmax, 1) + '°C' : '') + ' ' + stateName + suffix);
    }
    if (rain != null) {
      setTxt('m-rain', Math.round(rain) + ' mm');
      var rtEl = document.getElementById('m-rain-trend');
      if (rtEl) rtEl.textContent = stateName + ' 2000–2024 mean' + suffix;
    }
  }

  function applyStateNdviCard(stateName, vals, nTotal) {
    if (!stillBareState(stateName)) return;
    if (!vals.length) return;
    var m = mean(vals);
    setTxt('m-ndvi', fmt(m, 2));
    setBar('bar-ndvi', Math.round(m * 100));
    setTxt('ndvi-detail', stateName + ' · state mean, ' + vals.length + (nTotal ? ' of ' + nTotal : '') + ' real districts');
  }

  // ---------------------------------------------------------------------
  // Climate aggregate -> #historical-indices-panel
  // ---------------------------------------------------------------------
  function renderClimateState(stateName, rows, nTotal) {
    var host = document.getElementById('historical-indices-panel');
    if (!host) return;
    // mp_climate_loader.js's injectPanels() wraps this panel (plus
    // future-2040-panel/village-detail-panel, both left untouched and
    // empty here) in #mp-legacy-panel-wrap, display:none by default --
    // only mp_climate_loader.js's own refreshAll()/_mpClimateClear() ever
    // toggled it before this file existed, always tied to a REAL district
    // selection. A state-only selection needs the same reveal, or this
    // panel's real content renders into the DOM but stays invisible
    // (live-tested: exactly this, before this line was added).
    var wrap = document.getElementById('mp-legacy-panel-wrap');
    if (wrap) wrap.style.display = 'flex';
    var header = '<div class="section-header"><i class="fa fa-chart-line" style="color:var(--cyan);font-size:0.7rem"></i>'
      + '<div class="section-title">STATE-LEVEL AGGREGATE — ' + stateName + ' '
      + '<span style="color:var(--text-dim);font-weight:500;font-size:0.6rem;letter-spacing:0.3px">mean of ' + rows.length + ' of ' + (nTotal || '?') + ' real districts</span></div></div>';
    if (!rows.length) {
      host.innerHTML = header + '<div style="padding:0.75rem;color:var(--text-dim);font-size:0.75rem;">'
        + 'Not available yet for ' + stateName + ' — no district in this state has computed climate indices yet. Select a district once one is available, or see Data Sources for coverage.</div>';
      return;
    }
    function agg(geeKey, imdKey) { return mean(rows.map(function (idx) { return pick(idx, geeKey, imdKey); })); }
    var hw = agg('heatwave_days', 'heatwave_days_mean');
    var severeHw = agg('severe_heatwave_days', 'severe_heatwave_days_mean');
    var meanTmax = agg('mean_summer_tmax', 'mean_summer_tmax');
    var maxTmax = agg('max_summer_tmax', 'max_summer_tmax');
    var droughtMonths = agg('drought_months', 'drought_months_per_year_mean');
    var droughtPct = agg('drought_probability_pct', 'drought_probability_pct');
    var spi12 = agg('spi_12', 'spi12_year_end_mean');
    var rain = agg('annual_rain_mm', 'annual_rain_mm_mean');
    var r95p = agg('r95p_mm', 'r95p_mm_mean');
    var rx1day = agg('rx1day_mm', 'rx1day_mm_mean');
    var rx5day = agg('rx5day_mm', 'rx5day_mm_mean');
    var cdd = agg('cdd', 'cdd_mean');
    host.innerHTML = header
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card"><div class="metric-label">HEATWAVE DAYS/YR (mean)</div><div class="metric-value cyan">' + fmt(hw, 1) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">SEVERE HW DAYS (mean)</div><div class="metric-value" style="color:var(--red)">' + fmt(severeHw, 1) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">MEAN SUMMER TMAX</div><div class="metric-value" style="color:var(--orange)">' + fmt(meanTmax, 1) + '°C</div></div>'
      + '  <div class="metric-card"><div class="metric-label">MAX SUMMER TMAX (mean)</div><div class="metric-value" style="color:var(--red)">' + fmt(maxTmax, 1) + '°C</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DROUGHT MONTHS/YR (mean)</div><div class="metric-value" style="color:var(--orange)">' + fmt(droughtMonths, 1) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DROUGHT PROB % (mean)</div><div class="metric-value" style="color:var(--orange)">' + fmt(droughtPct, 1) + '%</div></div>'
      + '  <div class="metric-card"><div class="metric-label">SPI-12 (mean)</div><div class="metric-value" style="color:var(--blue)">' + fmt(spi12, 2) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">ANNUAL RAIN (mean)</div><div class="metric-value" style="color:var(--blue)">' + fmt(rain, 0) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">R95p / YR (mean)</div><div class="metric-value" style="color:var(--blue)">' + fmt(r95p, 1) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx1day (mean)</div><div class="metric-value" style="color:var(--blue)">' + fmt(rx1day, 1) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx5day (mean)</div><div class="metric-value" style="color:var(--blue)">' + fmt(rx5day, 1) + ' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">CDD (mean)</div><div class="metric-value" style="color:var(--orange)">' + fmt(cdd, 1) + ' d</div></div>'
      + '</div>'
      + '<div style="font-size:0.65rem;font-weight:600;color:var(--text-dim);padding:0 0.75rem 0.5rem">'
      + 'Each figure is the arithmetic mean of that many real districts’ own already-computed 2000–2024 values (IMD for MP’s 5 original districts, ERA5-Land+CHIRPS via GEE elsewhere) — not a new measurement, not interpolated for districts with no data yet. Select a district for its own single real number. See Data Sources.</div>';
  }

  // ---------------------------------------------------------------------
  // NDVI aggregate -> #national-ndvi-panel
  // ---------------------------------------------------------------------
  function renderNdviState(stateName, vals, nTotal) {
    var host = document.getElementById('national-ndvi-panel');
    if (!host) return;
    var header = '<div class="section-header"><i class="fa fa-leaf" style="color:var(--green,#6fc795);font-size:0.7rem"></i>'
      + '<div class="section-title">NDVI — STATE-LEVEL AGGREGATE — ' + stateName + ' '
      + '<span style="color:var(--text-dim);font-weight:500;font-size:0.6rem;letter-spacing:0.3px">mean of ' + vals.length + ' of ' + (nTotal || '?') + ' real districts</span></div></div>';
    if (!vals.length) {
      host.innerHTML = header + '<div style="padding:0.75rem;color:var(--text-dim);font-size:0.75rem;">'
        + 'Not available yet for ' + stateName + ' — no district in this state has computed NDVI yet.</div>';
      host.classList.remove('u-hidden');
      var emptyEl0 = document.getElementById('empty-chartNdvi');
      if (emptyEl0) emptyEl0.style.display = 'none';
      return;
    }
    var m = mean(vals);
    host.innerHTML = header
      + '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card"><div class="metric-label">MEAN NDVI (latest, across districts)</div><div class="metric-value" style="color:var(--green,#6fc795)">' + fmt(m, 3) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DISTRICTS AVERAGED</div><div class="metric-value cyan">' + vals.length + '</div></div>'
      + '</div>'
      + '<div style="font-size:0.65rem;font-weight:600;color:var(--text-dim);padding:0.5rem 0.75rem">'
      + 'Mean of each district’s own most recent real NDVI reading (UNDP DiCRA/MODIS for Madhya Pradesh’s 52 covered districts, MODIS MOD13Q1 via GEE elsewhere) — two different real sensors’ outputs averaged together only within one state’s own boundary, never across states. Select a district for its own single real reading and full time series. See Data Sources.</div>';
    host.classList.remove('u-hidden');
    var emptyEl = document.getElementById('empty-chartNdvi');
    if (emptyEl) emptyEl.style.display = 'none';
  }

  // ---------------------------------------------------------------------
  // Rainfall Monitor's chart panes: point the existing empty-state text at
  // the real aggregate above instead of a generic "Select a district" once
  // a State (but no district) is actually selected.
  // ---------------------------------------------------------------------
  var originalChartEmptyText = {};
  function setChartEmptyStateNote(stateName, hasData) {
    ['chartRain', 'chartTemp', 'chartTrends'].forEach(function (id) {
      var span = document.querySelector('#empty-' + id + ' span');
      if (!span) return;
      if (originalChartEmptyText[id] == null) originalChartEmptyText[id] = span.textContent;
      if (stateName) {
        span.textContent = hasData
          ? stateName + ' selected — a per-district time series chart needs a district (GEE’s per-district file is a single 2000–2024 mean, not month/year data to chart). See the state-level aggregate numbers above for ' + stateName + '.'
          : 'Select a district — climate data not yet computed for any district in ' + stateName + '.';
      } else {
        span.textContent = originalChartEmptyText[id];
      }
    });
  }

  function clearAll() {
    var host = document.getElementById('historical-indices-panel');
    if (host && host.innerHTML.indexOf('STATE-LEVEL AGGREGATE') !== -1) host.innerHTML = '';
    var host2 = document.getElementById('national-ndvi-panel');
    if (host2 && host2.innerHTML.indexOf('STATE-LEVEL AGGREGATE') !== -1) { host2.classList.add('u-hidden'); host2.innerHTML = ''; }
    setChartEmptyStateNote(null, false);
  }

  var currentToken = 0;
  function onStateSelected(stateName) {
    var myToken = ++currentToken; // if the user picks another state/district before this resolves, stale results are dropped
    if (!stateName) { clearAll(); return; }
    var stateSlug = slugify(stateName);

    Promise.all([loadClimateManifest(), loadDistrictsIndex(), waitForMpClimateData()]).then(function (results) {
      if (myToken !== currentToken) return;
      var allKeys = results[0], totals = results[1], mpData = results[2];
      var nTotal = totals ? totals[stateName] : null;

      var geeKeys = allKeys.filter(function (k) { return k.indexOf(stateSlug + '/') === 0; });
      var fetches = geeKeys.map(function (k) {
        var parts = k.split('/');
        return loadClimateFile(parts[0], parts[1]);
      });
      Promise.all(fetches).then(function (files) {
        if (myToken !== currentToken) return;
        var rows = files.filter(Boolean).map(function (f) { return f.indices || {}; });
        // Madhya Pradesh's 5 IMD-real districts live in mp_climate_data.json,
        // not climate_manifest.json's GEE list -- add them in only for MP.
        if (stateName === 'Madhya Pradesh' && mpData && mpData.districts) {
          Object.keys(mpData.districts).forEach(function (k) {
            var d = mpData.districts[k];
            if (d && d.indices) rows.push(d.indices);
          });
        }
        renderClimateState(stateName, rows, nTotal);
        applyStateClimateCards(stateName, rows, nTotal);
        setChartEmptyStateNote(stateName, rows.length > 0);
      });
    });

    loadNdviManifests().then(function (res) {
      if (myToken !== currentToken) return;
      // AUDIT_FIX_PROMPT.md item 0C part 2 (live-tested bug, fixed): data/
      // ndvi_manifest.json's gee_modis.districts list is comprehensive
      // (all 733 districts, MP's own 52 included) -- it is NOT already
      // "every district outside DiCRA's coverage" the way
      // national_ndvi_loader.js's own runtime comment describes it; that
      // exclusivity is enforced by national_ndvi_loader.js's own
      // dicraDistricts skip-check at render time, not by this file's
      // contents. Filtering it out here too (same skip-set: dicra_ndvi.json's
      // own district keys) avoids counting a MP district's DiCRA reading
      // AND its GEE reading as two separate "real districts" in one mean.
      var dicraSlugs = {};
      if (res.dicra) Object.keys(res.dicra).forEach(function (k) { dicraSlugs[ndviCanonicalSlug(k)] = true; });
      var ndviKeys = res.ndviDistrictKeys.filter(function (k) {
        if (k.indexOf(stateSlug + '/') !== 0) return false;
        var dslug = k.split('/')[1];
        return !dicraSlugs[ndviCanonicalSlug(dslug)];
      });
      var geeFetches = ndviKeys.map(function (k) {
        var parts = k.split('/');
        return loadNdviFile(parts[0], parts[1]).then(function (f) { return f && f.period_summary ? f.period_summary.ndvi_mean : null; });
      });
      // DiCRA's own file (dicra_ndvi.json) is itself Madhya Pradesh-only
      // (see dicra_ndvi_loader.js's own module header) -- only relevant
      // when the selected state actually is MP; any other state's real
      // NDVI here comes entirely from the GEE-MODIS fetches above.
      var dicraVals = [];
      if (stateName === 'Madhya Pradesh' && res.dicra) {
        Object.keys(res.dicra).forEach(function (k) {
          var series = res.dicra[k] && res.dicra[k].ndvi_mean;
          if (series && series.length) dicraVals.push(series[series.length - 1]);
        });
      }
      Promise.all(geeFetches).then(function (geeVals) {
        if (myToken !== currentToken) return;
        var all = dicraVals.concat(geeVals.filter(function (v) { return v != null; }));
        loadDistrictsIndex().then(function (totals) {
          if (myToken !== currentToken) return;
          renderNdviState(stateName, all, totals ? totals[stateName] : null);
          applyStateNdviCard(stateName, all, totals ? totals[stateName] : null);
        });
      });
    });
  }
  window.onStateSelected = onStateSelected;
})();

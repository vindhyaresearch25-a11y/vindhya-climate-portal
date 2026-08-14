/*
 * national_ndvi_loader.js -- fills the NDVI panel for districts OUTSIDE
 * Madhya Pradesh's 52 DiCRA districts, using
 * dashboard/data/ndvi/<state_slug>/<district_slug>.json (real MODIS
 * MOD13Q1 v061 via Google Earth Engine, scripts/10_gee_national_ndvi.py,
 * Phase 8.4).
 *
 * dicra_ndvi_loader.js already owns MP's 52 districts and the NDVI chart
 * canvas for them; this file explicitly SKIPS any district
 * dicra_ndvi.json already has data for, and never overwrites/merges with
 * it -- the two NDVI sources (UNDP DiCRA vs MODIS/GEE) are always shown
 * labelled separately, per STANDING ORDERS / Phase 8.7 ("observed,
 * projected aur validation teeno ALAG, kabhi mila kar nahi" applies
 * equally here to the two observed-NDVI sources).
 */
(function () {
  'use strict';

  var manifestPromise = null;
  var lookup = null;       // districtSlug -> {stateSlug, districtSlug}
  var dicraDistricts = {}; // slug -> true, districts dicra_ndvi_loader.js already owns
  var cache = {};

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

  function fmt(v, d) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d == null ? 3 : d);
  }
  function setTxt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function setBar(id, pct) { var e = document.getElementById(id); if (e) e.style.width = pct + '%'; }

  function loadManifests() {
    if (manifestPromise) return manifestPromise;
    manifestPromise = Promise.all([
      fetchWithTimeout('data/ndvi_manifest.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetchWithTimeout('data/dicra_ndvi.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      var manifest = results[0];
      var dicra = results[1];
      lookup = {};
      if (manifest && manifest.gee_modis && Array.isArray(manifest.gee_modis.districts)) {
        manifest.gee_modis.districts.forEach(function (entry) {
          var parts = entry.split('/');
          if (parts.length === 2) lookup[parts[1]] = { stateSlug: parts[0], districtSlug: parts[1] };
        });
      }
      dicraDistricts = {};
      if (dicra && dicra.districts) {
        Object.keys(dicra.districts).forEach(function (k) { dicraDistricts[slugify(k)] = true; });
      }
      return lookup;
    }).catch(function () { lookup = {}; return lookup; });
    return manifestPromise;
  }

  function applyGeeNdvi(file, districtName) {
    var summary = file.period_summary || {};
    var meta = file.metadata || {};

    var ndviVal = summary.ndvi_mean != null ? summary.ndvi_mean : null;
    if (ndviVal != null) {
      setTxt('m-ndvi', fmt(ndviVal, 2) + ' (MODIS)');
      setBar('bar-ndvi', Math.min(100, Math.max(0, Math.round(ndviVal * 100))));
    } else {
      setTxt('m-ndvi', 'Not available');
      setBar('bar-ndvi', 0);
    }

    var host = document.getElementById('national-ndvi-panel');
    if (host) {
      var rows = (file.annual_ndvi || []).map(function (r) {
        return '<tr><td>' + r.year + '</td><td>' + fmt(r.ndvi_mean, 3) + '</td>'
          + '<td>' + fmt(r.ndvi_stddev, 3) + '</td><td>' + r.pixel_count + '</td></tr>';
      }).join('');
      host.innerHTML = ''
        + '<div class="section-header"><i class="fa fa-leaf" style="color:var(--green,#6fc795);font-size:0.7rem"></i>'
        + '<div class="section-title">NDVI — ' + (districtName || '') + ' '
        + '<span style="color:var(--text-dim);font-weight:500;font-size:0.6rem;letter-spacing:0.3px">MODIS MOD13Q1 via GEE, NOT DiCRA</span></div></div>'
        + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
        + '  <div class="metric-card"><div class="metric-label">MEAN NDVI 2000–2024</div><div class="metric-value" style="color:var(--green,#6fc795)">' + fmt(summary.ndvi_mean, 3) + '</div></div>'
        + '  <div class="metric-card"><div class="metric-label">STD DEV</div><div class="metric-value" style="color:var(--orange)">' + fmt(summary.ndvi_stddev, 3) + '</div></div>'
        + '  <div class="metric-card"><div class="metric-label">MIN / MAX</div><div class="metric-value" style="color:var(--blue)">' + fmt(summary.ndvi_min, 2) + ' / ' + fmt(summary.ndvi_max, 2) + '</div></div>'
        + '  <div class="metric-card"><div class="metric-label">YEARS COVERED</div><div class="metric-value cyan">' + (summary.years_covered != null ? summary.years_covered : '—') + '</div></div>'
        + '</div>'
        + '<div style="max-height:160px;overflow:auto;padding:0 0.75rem;">'
        + '<table style="width:100%;font-size:0.65rem;border-collapse:collapse;"><thead><tr style="text-align:left;color:var(--text-dim)"><th>Year</th><th>NDVI mean</th><th>Std dev</th><th>Pixels</th></tr></thead><tbody>'
        + rows + '</tbody></table></div>'
        + '<div style="font-size:0.65rem;font-weight:600;color:var(--text-dim);padding:0.5rem 0.75rem">'
        + 'Source: MODIS MOD13Q1 v061 (Terra, 250m, 16-day) via Google Earth Engine. '
        + 'Distinct from UNDP DiCRA (used for Madhya Pradesh\'s 52 districts) — never merged. See Data Sources.</div>';
      host.classList.remove('u-hidden');
    }
    // AUDIT_FIX_PROMPT.md item 9: real content is showing below (this
    // panel), not in the #chartNdvi canvas above it (that's DiCRA-only) --
    // hide that canvas's own "select a district" message so the two don't
    // both claim empty/full at once.
    var emptyEl = document.getElementById('empty-chartNdvi');
    if (emptyEl) emptyEl.style.display = 'none';
  }

  function clearNationalPanel() {
    var host = document.getElementById('national-ndvi-panel');
    if (host) host.classList.add('u-hidden');
    // Only re-show the chart's empty state if dicra_ndvi_loader.js hasn't
    // already drawn a real chart into that same canvas for this district
    // (Chart.js keeps a live registry keyed by canvas -- this is a safe
    // check regardless of which loader's handler ran first).
    var hasRealChart = (typeof Chart !== 'undefined' && Chart.getChart) ? !!Chart.getChart('chartNdvi') : false;
    if (!hasRealChart) {
      var emptyEl = document.getElementById('empty-chartNdvi');
      if (emptyEl) emptyEl.style.display = 'flex';
    }
  }

  function handleDistrictChange(districtName) {
    if (!districtName) return;
    var dslug = slugify(districtName);
    if (dicraDistricts[dslug]) { clearNationalPanel(); return; } // dicra_ndvi_loader.js owns this one
    loadManifests().then(function () {
      var entry = lookup[dslug];
      if (!entry) { clearNationalPanel(); return; } // GEE hasn't computed this district's NDVI yet
      var key = entry.stateSlug + '/' + entry.districtSlug;
      if (cache[key]) { applyGeeNdvi(cache[key], districtName); return; }
      fetchWithTimeout('data/ndvi/' + entry.stateSlug + '/' + entry.districtSlug + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (file) {
          if (!file) { clearNationalPanel(); return; }
          cache[key] = file;
          applyGeeNdvi(file, districtName);
        })
        .catch(function () { clearNationalPanel(); });
    });
  }

  function boot() {
    loadManifests();
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      if (typeof originalOnDistrictChange === 'function') originalOnDistrictChange(distKey);
      handleDistrictChange(distKey);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }
})();

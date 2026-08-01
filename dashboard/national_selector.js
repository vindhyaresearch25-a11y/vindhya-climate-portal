/*
 * national_selector.js — VINDHYA Climate Portal
 *
 * Unlocks the Country/State/District/Village location selector to cover all
 * of India, using real boundary/name data (dashboard/data/boundaries/), not
 * just the 5 Madhya Pradesh districts that have live IMD/DiCRA climate data.
 *
 * Naming vs. data availability (project rule -- never fabricate):
 *   - District/village NAMES come from real boundary sources for every
 *     state/UT that has one (see dashboard/data/boundaries/README.md).
 *   - Climate METRICS only exist for Bhopal, Indore, Jabalpur, Rewa, Sidhi
 *     (Madhya Pradesh). Selecting anything else shows an explicit
 *     "Data not yet available" state on every metric card -- never a
 *     fabricated number, never a silent fallback to a parent level.
 *   - States/UTs with no village boundary source at all show
 *     "Data pending for this area" in the dropdown itself.
 */
(function () {
  'use strict';

  var REAL_DATA_DISTRICTS = { bhopal: 1, indore: 1, jabalpur: 1, rewa: 1, sidhi: 1 };
  var namesIndex = null;               // dashboard/data/boundaries/names_index.json
  var districtsByState = {};           // state name -> [{district, dt_code}]
  var currentStateName = 'Madhya Pradesh';
  var currentPerStateNames = null;     // loaded names/<slug>.json for the selected state

  function el(id) { return document.getElementById(id); }

  function slugFromFile(file) {
    // "villages/madhya_pradesh.geojson" -> "madhya_pradesh"
    var m = /([^/]+)\.geojson$/.exec(file || '');
    return m ? m[1] : null;
  }

  // ---------------------------------------------------------------------
  // Load: names index (tiny) + all-India district list (already shipped)
  // ---------------------------------------------------------------------
  function loadNamesIndex() {
    return fetch('data/boundaries/names_index.json').then(function (r) { return r.ok ? r.json() : null; });
  }
  function loadDistrictBoundaries() {
    return fetch('data/boundaries/india_districts.geojson').then(function (r) { return r.ok ? r.json() : null; });
  }

  function unlockSelector() {
    var country = el('countrySelect');
    var state = el('stateSelect');
    if (country) { country.disabled = false; }
    if (state) { state.disabled = false; }
    document.querySelectorAll('.loc-field.locked .loc-lock-icon').forEach(function (i) { i.remove(); });
    document.querySelectorAll('.loc-field.locked').forEach(function (f) { f.classList.remove('locked'); });
  }

  function populateStateSelect() {
    var sel = el('stateSelect');
    if (!sel || !namesIndex) return;
    var names = Object.keys(namesIndex.states).sort();
    sel.innerHTML = '';
    names.forEach(function (name) {
      var o = document.createElement('option');
      o.value = name;
      var status = namesIndex.states[name].status;
      o.textContent = name + (status === 'pending' ? ' (data pending)' : '');
      if (name === 'Madhya Pradesh') o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { onStateChange(this.value); };
  }

  function districtsForState(stateName) {
    return districtsByState[stateName] || [];
  }

  function onStateChange(stateName) {
    currentStateName = stateName;
    currentPerStateNames = null;
    var distSel = el('districtSelect');
    distSel.innerHTML = '<option value="">-- Select District --</option>';

    var entry = namesIndex && namesIndex.states[stateName];
    if (entry && entry.status === 'pending') {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Data pending for this area';
      opt.disabled = true;
      distSel.appendChild(opt);
      resetToNoData(stateName, null, null);
      updateBreadcrumbNational(stateName, null, null);
      return;
    }

    var districts = districtsForState(stateName).slice().sort(function (a, b) { return a.district.localeCompare(b.district); });
    if (!districts.length) {
      var opt2 = document.createElement('option');
      opt2.value = '';
      opt2.textContent = 'Data pending for this area';
      opt2.disabled = true;
      distSel.appendChild(opt2);
      resetToNoData(stateName, null, null);
      updateBreadcrumbNational(stateName, null, null);
      return;
    }
    districts.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.district;
      o.textContent = d.district;
      distSel.appendChild(o);
    });

    // Preload the per-state village names file (only for states that have one)
    if (entry && entry.status === 'available' && entry.names_file) {
      fetch('data/boundaries/' + entry.names_file)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { currentPerStateNames = data; })
        .catch(function () { currentPerStateNames = null; });
    }
    updateBreadcrumbNational(stateName, null, null);
  }

  function onNationalDistrictChange(districtName) {
    var villSel = el('villageSelect');
    var villField = el('villageField');
    villSel.innerHTML = '<option value="">-- Select District First --</option>';
    if (!districtName) { villField.style.display = 'none'; updateBreadcrumbNational(currentStateName, null, null); return; }

    // Real MP districts with live climate data keep the existing, unmodified
    // flow (populateDistricts/onDistrictChange/MP_DISTRICTS) -- this
    // function only handles districts outside that known-good set.
    var mpKey = mpDistrictKeyFor(currentStateName, districtName);
    if (mpKey) { return; } // handled by the original onDistrictChange via MP_DISTRICTS

    resetToNoData(currentStateName, districtName, null);
    villField.style.display = 'block';
    var allVillages = currentPerStateNames && currentPerStateNames.districts && currentPerStateNames.districts[districtName];
    // Some source records have no name at all (~10% in parts of this
    // dataset, a known upstream data-quality gap -- see
    // dashboard/data/boundaries/README.md). They're left out of the picker
    // rather than shown as a blank, unselectable-looking option; the real
    // village count in that README/manifest still includes them.
    var villages = allVillages ? allVillages.filter(function (v) { return v.name && v.name.trim(); }) : null;
    if (villages && villages.length) {
      villages.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v.vil_lgd != null ? String(v.vil_lgd) : v.name;
        o.textContent = v.name;
        villSel.appendChild(o);
      });
      villSel.disabled = false;
    } else {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Data pending for this area';
      opt.disabled = true;
      villSel.appendChild(opt);
      villSel.disabled = true;
    }
    updateBreadcrumbNational(currentStateName, districtName, null);
  }

  function onNationalVillageChange(villageLabel) {
    resetToNoData(currentStateName, el('districtSelect').value, villageLabel || null);
    updateBreadcrumbNational(currentStateName, el('districtSelect').value, villageLabel || null);
  }

  function mpDistrictKeyFor(stateName, districtName) {
    if (stateName !== 'Madhya Pradesh' || !districtName) return null;
    var key = districtName.trim().toLowerCase();
    return REAL_DATA_DISTRICTS[key] ? key : null;
  }

  // ---------------------------------------------------------------------
  // Honest "not available" rendering for any state/district/village that
  // isn't one of the 5 MP districts with real IMD/DiCRA data. Never calls
  // the MP_DISTRICTS-specific renderers (which would throw or show stale
  // data for an unrecognised key) -- resets every metric card explicitly.
  // ---------------------------------------------------------------------
  function resetToNoData(stateName, districtName, villageName) {
    var label = villageName || districtName || stateName;
    var NA = 'Not available';
    var ids = ['m-drought', 'm-heat', 'm-rain', 'm-soil', 'm-ndvi', 'm-crop', 'm-gw'];
    ids.forEach(function (id) { var e = el(id); if (e) e.textContent = NA; });
    ['bar-drought', 'bar-heat', 'bar-rain', 'bar-ndvi', 'bar-crop', 'bar-gw'].forEach(function (id) {
      var e = el(id); if (e) e.style.width = '0%';
    });
    var rt = el('m-rain-trend'); if (rt) rt.textContent = label;
    var hd = el('heat-detail'); if (hd) hd.textContent = label;

    var advTitle = el('adv-title-0');
    if (advTitle) advTitle.textContent = 'Data not yet available for ' + label;
    var advBody = el('adv-body-0');
    if (advBody) advBody.textContent = 'This location is outside the 5 districts (Bhopal, Indore, Jabalpur, Rewa, Sidhi) currently covered by IMD-derived climate data. Coverage is being expanded -- see docs/NATIONAL_SCALE_RESEARCH.md.';

    if (window.leafletMap && window._villageLayer) {
      window.leafletMap.removeLayer(window._villageLayer);
      window._villageLayer = null;
    }
  }

  function updateBreadcrumbNational(stateName, districtName, villageName) {
    var el2 = el('locBreadcrumb');
    if (!el2) return;
    var parts = ['<b>India</b>', '<b>' + stateName + '</b>'];
    if (districtName) parts.push('<b>' + districtName + '</b>');
    if (villageName) parts.push('<b>' + villageName + '</b>');
    el2.innerHTML = parts.join(' &rsaquo; ');
  }

  // ---------------------------------------------------------------------
  // Boot: wait for the app's own init (populateDistricts etc.) to have run,
  // then layer the national selector on top without disturbing the
  // existing Madhya Pradesh flow.
  // ---------------------------------------------------------------------
  function boot() {
    Promise.all([loadNamesIndex(), loadDistrictBoundaries()]).then(function (results) {
      namesIndex = results[0];
      var districtsGeo = results[1];
      if (!namesIndex || !districtsGeo) return;
      window._nationalBoundaryState = { namesIndex: namesIndex };

      districtsByState = {};
      districtsGeo.features.forEach(function (f) {
        var p = f.properties || {};
        if (!p.state || !p.district) return;
        (districtsByState[p.state] = districtsByState[p.state] || []).push({ district: p.district, dt_code: p.dt_code });
      });

      unlockSelector();
      populateStateSelect();

      // Wrap the existing onDistrictChange so MP districts keep their
      // original behaviour, and every other district in Madhya Pradesh (or
      // any other state) falls through to the honest "not available" path.
      var originalOnDistrictChange = window.onDistrictChange;
      window.onDistrictChange = function (distKey) {
        if (currentStateName === 'Madhya Pradesh' && typeof MP_DISTRICTS !== 'undefined' && MP_DISTRICTS[distKey]) {
          originalOnDistrictChange(distKey);
        } else {
          onNationalDistrictChange(distKey);
        }
      };
      var originalOnVillageChange = window.onVillageChange;
      window.onVillageChange = function (village) {
        if (currentStateName === 'Madhya Pradesh' && typeof MP_DISTRICTS !== 'undefined' &&
            MP_DISTRICTS[el('districtSelect').value] && REAL_DATA_DISTRICTS[el('districtSelect').value]) {
          originalOnVillageChange(village);
        } else {
          onNationalVillageChange(village);
        }
      };
    }).catch(function (e) { console.warn('[national_selector] failed to init:', e); });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 50);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
  }
})();

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
  var districtsGeoData = null;         // full india_districts.geojson, cached from boot()
  var statesGeoData = null;            // full india_states.geojson, fetched lazily on first use
  var currentStateName = 'Madhya Pradesh';
  var currentPerStateNames = null;     // loaded names/<slug>.json for the selected state
  var nationalHighlightLayer = null;   // single tracked layer: the currently selected state/district/village outline

  function el(id) { return document.getElementById(id); }

  function slugFromFile(file) {
    // "villages/madhya_pradesh.geojson" -> "madhya_pradesh"
    var m = /([^/]+)\.geojson$/.exec(file || '');
    return m ? m[1] : null;
  }

  // ---------------------------------------------------------------------
  // Load: names index (tiny) + all-India district list (already shipped).
  // Both go through fetchWithTimeoutSafe (30s timeout, resolves null on any
  // failure instead of rejecting/hanging) -- if either is missing or slow,
  // boot() below leaves the selector in its original MP-only state instead
  // of leaving Country/State locked-but-silent forever.
  // ---------------------------------------------------------------------
  function loadNamesIndex() {
    return fetchWithTimeoutSafe('data/boundaries/names_index.json', FETCH_TIMEOUT_MS);
  }
  function loadDistrictBoundaries() {
    return fetchWithTimeoutSafe('data/boundaries/india_districts.geojson', FETCH_TIMEOUT_MS);
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
    highlightStateOnMap(stateName);

    if (stateName === 'Madhya Pradesh' && typeof populateDistricts === 'function') {
      // Madhya Pradesh keeps its own original district list (the 5
      // MP_DISTRICTS keys with live climate data) -- never overwrite it
      // with the national district list, even if the user navigates away
      // to another state and back. onDistrictChange/onVillageChange are
      // already wrapped in boot() to route MP_DISTRICTS keys back to the
      // original MP-specific handlers.
      populateDistricts();
      resetToNoData(stateName, null, null);
      updateBreadcrumb();
      return;
    }

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
    if (!districtName) { villField.style.display = 'none'; clearVillageLayerAndMarker(); updateBreadcrumbNational(currentStateName, null, null); return; }

    // Real MP districts with live climate data keep the existing, unmodified
    // flow (populateDistricts/onDistrictChange/MP_DISTRICTS) -- this
    // function only handles districts outside that known-good set.
    var mpKey = mpDistrictKeyFor(currentStateName, districtName);
    if (mpKey) { return; } // handled by the original onDistrictChange via MP_DISTRICTS

    resetToNoData(currentStateName, districtName, null);
    highlightDistrictOnMap(currentStateName, districtName);
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

  // villageValue is the <option value>, which is the village's LGD code
  // whenever one exists (see onNationalDistrictChange) -- not a display
  // name. Resolve the real name from the already-loaded per-state names
  // data before using it anywhere (breadcrumb, map popup); fall back to
  // the raw value only if a name genuinely isn't available.
  function resolveVillageName(districtName, villageValue) {
    var villages = currentPerStateNames && currentPerStateNames.districts && currentPerStateNames.districts[districtName];
    if (!villages) return villageValue;
    var match = villages.filter(function (v) {
      return (v.vil_lgd != null && String(v.vil_lgd) === String(villageValue)) || v.name === villageValue;
    })[0];
    return match ? match.name : villageValue;
  }

  function onNationalVillageChange(villageValue) {
    var districtName = el('districtSelect').value;
    var villageName = villageValue ? resolveVillageName(districtName, villageValue) : null;
    resetToNoData(currentStateName, districtName, villageName);
    updateBreadcrumbNational(currentStateName, districtName, villageName);

    if (!villageValue) {
      // Deselecting the village: drop the marker, keep the district's
      // green village layer (matches MP -- picking "-- Select --" doesn't
      // remove window._villageLayer either).
      var map = window.leafletMap;
      if (map && window.villageMarker) { map.removeLayer(window.villageMarker); window.villageMarker = null; }
      return;
    }

    var entry = namesIndex && namesIndex.states[currentStateName];
    if (!entry || entry.status !== 'available') {
      clearNationalHighlight();
      showBoundaryLoadStatus('<i class="fa fa-triangle-exclamation" style="color:var(--orange)"></i> ' +
        t('Village boundary data pending official source for this state.', 'इस राज्य के लिए गाँव की सीमा डेटा अभी उपलब्ध नहीं है।'));
      setTimeout(hideBoundaryLoadStatus, 5000);
      return;
    }
    highlightVillageOnMap(currentStateName, districtName, villageValue).then(function (found) {
      if (!found) {
        showBoundaryLoadStatus('<i class="fa fa-triangle-exclamation" style="color:var(--orange)"></i> ' +
          t('Village boundary data pending for ' + villageName + '.', villageName + ' के लिए सीमा डेटा उपलब्ध नहीं है।'));
        setTimeout(hideBoundaryLoadStatus, 5000);
      }
    });
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
    // Deliberately does NOT touch window._villageLayer/villageMarker here --
    // matching the MP flow, the district's green village layer must stay
    // visible when a specific village is then selected within it. Map
    // layer clearing/redrawing is the job of highlightStateOnMap /
    // highlightDistrictOnMap / highlightVillageOnMap below, called by the
    // same code paths that call this function.
    var navBadgeHeat = el('nav-badge-heat');
    if (navBadgeHeat) navBadgeHeat.style.display = 'none';
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
  // Village boundary GEOMETRY (5-63 MB per state, unlike the tiny names/
  // index files above): 30s timeout, a loading indicator that states the
  // real file size up front, a cached-in-memory result so a state never
  // downloads twice, and a fallback that never blocks the page -- a
  // timeout or network error just means no extra village layer draws,
  // the rest of the app (including the existing MP flow) is unaffected.
  // ---------------------------------------------------------------------
  var villageGeomCache = {};      // geometry_file -> parsed GeoJSON
  var villageGeomInflight = {};   // geometry_file -> Promise, de-dupes concurrent requests
  var FETCH_TIMEOUT_MS = 30000;

  function showBoundaryLoadStatus(html) {
    var box = el('boundaryLoadStatus');
    if (!box) return;
    box.innerHTML = html;
    box.style.display = 'block';
  }
  function hideBoundaryLoadStatus() {
    var box = el('boundaryLoadStatus');
    if (box) box.style.display = 'none';
  }

  function fetchWithTimeout(url, timeoutMs) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
  }

  // Same as fetchWithTimeout, but never rejects -- resolves null on any
  // timeout/network/HTTP error. Used for the two boot()-time fetches so a
  // missing or slow file degrades to "national selector stays MP-only"
  // instead of an unhandled rejection or an indefinitely pending promise.
  function fetchWithTimeoutSafe(url, timeoutMs) {
    return fetchWithTimeout(url, timeoutMs).catch(function (e) {
      console.warn('[national_selector] fetch failed, falling back to MP-only:', url, e);
      return null;
    });
  }

  // Loads the real village-boundary GeoJSON for a state, honouring cache.
  // Returns a Promise resolving to the parsed GeoJSON, or null on any
  // failure/timeout (never rejects -- callers should treat null as "no
  // extra layer this time" and carry on).
  function loadNationalVillageGeometry(stateName) {
    var entry = namesIndex && namesIndex.states[stateName];
    if (!entry || entry.status !== 'available' || !entry.geometry_file) return Promise.resolve(null);
    var file = entry.geometry_file;

    if (villageGeomCache[file]) return Promise.resolve(villageGeomCache[file]);
    if (villageGeomInflight[file]) return villageGeomInflight[file];

    var sizeMb = entry.geometry_file_size_mb;
    var etaText = sizeMb == null ? '' : (sizeMb > 30 ? ' -- 2-3 minutes on a slow connection' : sizeMb > 8 ? ' -- 30-60 seconds on a slow connection' : '');
    showBoundaryLoadStatus(
      '<i class="fa fa-spinner fa-spin"></i> ' +
      stateName + ' ' + t('ki seemayein laayi ja rahi hain', 'boundaries loading') +
      (sizeMb != null ? ' (' + sizeMb + ' MB)' : '') + etaText + '...'
    );

    var p = fetchWithTimeout('data/boundaries/' + file, FETCH_TIMEOUT_MS)
      .then(function (data) {
        villageGeomCache[file] = data;
        hideBoundaryLoadStatus();
        return data;
      })
      .catch(function (e) {
        var isTimeout = e && e.name === 'AbortError';
        showBoundaryLoadStatus(
          '<i class="fa fa-triangle-exclamation" style="color:var(--orange)"></i> ' +
          stateName + ' ' + (isTimeout
            ? t('ki boundaries load nahi ho payin (timeout). Naam/dropdown kaam karte rahenge, sirf map par extra layer nahi dikhega.', 'boundaries timed out loading -- names still work, just no extra map layer.')
            : t('ki boundaries load nahi ho payin. Naam/dropdown kaam karte rahenge.', 'boundaries failed to load -- names still work.'))
        );
        setTimeout(hideBoundaryLoadStatus, 6000);
        console.warn('[national_selector] village geometry load failed for', stateName, e);
        return null;
      })
      .finally(function () { delete villageGeomInflight[file]; });
    villageGeomInflight[file] = p;
    return p;
  }

  function t(en, hi) {
    try { return (window.LANG === 'hi' || document.body.classList.contains('lang-hi')) ? hi : en; }
    catch (e) { return en; }
  }

  window.loadNationalVillageGeometry = loadNationalVillageGeometry;

  // ---------------------------------------------------------------------
  // Map behaviour for state/district/village selection outside Madhya
  // Pradesh. This deliberately reuses the SAME mechanism the original MP
  // flow already uses (dashboard/index.html: flyToDistrict, onVillageChange,
  // applyVillageStyle/loadVillageBoundaries) rather than a separate look --
  // same global layer variables (window._villageLayer, window.villageMarker),
  // same colours, same flyTo/zoom levels, so a user can't tell there are two
  // code paths underneath. See docs/AUDIT_2026-08-01.md follow-up and the
  // MP pattern read directly from index.html before writing this.
  //
  //   District select (MP): flyTo(district centroid, zoom 9) + render every
  //     village of that district as green (#2d8f5c) low-opacity polygons in
  //     window._villageLayer (applyVillageStyle's default, non-hazard style).
  //   Village select (MP): flyTo(village point, zoom 14) + a single marker
  //     + popup in window.villageMarker -- the district's green village
  //     layer stays visible underneath, it is not replaced by an outline.
  // ---------------------------------------------------------------------
  var VILLAGE_DEFAULT_STYLE = { color: '#2d8f5c', weight: 0.8, opacity: 0.7, fillColor: '#2d8f5c', fillOpacity: 0.06 };
  var STATE_OUTLINE_STYLE = { color: '#ffd166', weight: 2.2, fill: false, opacity: 0.95 }; // MP has no state-select precedent of its own, so this reuses the state-outline convention already established elsewhere in the app

  function clearNationalHighlight() {
    // No longer used by district/village (they now reuse window._villageLayer
    // / window.villageMarker directly, cleared the same way the MP flow
    // already clears them) -- kept only for the state-level outline, which
    // has no MP equivalent to reuse.
    if (nationalHighlightLayer && window.leafletMap) {
      window.leafletMap.removeLayer(nationalHighlightLayer);
    }
    nationalHighlightLayer = null;
  }

  function clearVillageLayerAndMarker() {
    var map = window.leafletMap;
    if (!map) return;
    if (window._villageLayer) { map.removeLayer(window._villageLayer); window._villageLayer = null; }
    if (window.villageMarker) { map.removeLayer(window.villageMarker); window.villageMarker = null; }
  }

  function loadStatesGeo() {
    if (statesGeoData) return Promise.resolve(statesGeoData);
    return fetchWithTimeoutSafe('data/boundaries/india_states.geojson', FETCH_TIMEOUT_MS).then(function (d) {
      statesGeoData = d;
      return d;
    });
  }

  function highlightStateOnMap(stateName) {
    clearNationalHighlight();
    clearVillageLayerAndMarker();
    loadStatesGeo().then(function (geo) {
      if (!geo) return;
      var feature = geo.features.filter(function (f) { return f.properties && f.properties.state === stateName; })[0];
      var map = window.leafletMap;
      if (!feature || !map) return;
      nationalHighlightLayer = L.geoJSON(feature, { style: STATE_OUTLINE_STYLE }).addTo(map);
      var bounds = nationalHighlightLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    });
  }

  // District select: same mechanism as MP's loadVillageBoundaries() +
  // applyVillageStyle() + flyToDistrict() combined -- flies to the
  // district's centroid at zoom 9, then draws every village of that
  // district into window._villageLayer with the identical default style
  // and popup format applyVillageStyle uses for MP villages.
  function highlightDistrictOnMap(stateName, districtName) {
    clearNationalHighlight(); // the state outline is no longer needed once a district is picked
    var map = window.leafletMap;
    if (!map) return;

    if (districtsGeoData) {
      var distFeature = districtsGeoData.features.filter(function (f) {
        return f.properties && f.properties.state === stateName && f.properties.district === districtName;
      })[0];
      if (distFeature) {
        var b = L.geoJSON(distFeature).getBounds();
        if (b.isValid()) map.flyTo(b.getCenter(), 9, { duration: 1.5 });
      }
    }

    var entry = namesIndex && namesIndex.states[stateName];
    if (!entry || entry.status !== 'available') {
      clearVillageLayerAndMarker();
      showBoundaryLoadStatus('<i class="fa fa-triangle-exclamation" style="color:var(--orange)"></i> ' +
        t('Village boundary data pending official source for this state.', 'इस राज्य के लिए गाँव की सीमा डेटा अभी उपलब्ध नहीं है।'));
      setTimeout(hideBoundaryLoadStatus, 5000);
      return;
    }
    loadNationalVillageGeometry(stateName).then(function (geo) {
      clearVillageLayerAndMarker();
      if (!geo) return;
      var features = geo.features.filter(function (f) { return f.properties && f.properties.district_name === districtName; });
      if (!features.length) return;
      window._villageLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
        style: function () { return VILLAGE_DEFAULT_STYLE; },
        onEachFeature: function (feat, layer) {
          var nm = feat.properties.village_name || 'Unnamed';
          layer.bindPopup('<div><b style="color:var(--cyan)">' + nm + '</b><br>' +
            '<span style="font-size:0.62rem;color:#5a6a7a">' + districtName + ' village</span></div>');
        }
      }).addTo(map);
    });
  }

  // Village select: same mechanism as MP's onVillageChange() -- flies to
  // the village's point at zoom 14 and drops a single marker+popup into
  // window.villageMarker. The district's green village layer (drawn by
  // highlightDistrictOnMap above) is left in place, exactly like MP leaves
  // window._villageLayer showing while a village marker is added on top.
  function highlightVillageOnMap(stateName, districtName, vilLgd) {
    var entry = namesIndex && namesIndex.states[stateName];
    if (!entry || entry.status !== 'available') return Promise.resolve(false);
    return loadNationalVillageGeometry(stateName).then(function (geo) {
      var map = window.leafletMap;
      if (!geo || !map) return false;
      var feature = geo.features.filter(function (f) {
        return f.properties && String(f.properties.vil_lgd) === String(vilLgd) && f.properties.district_name === districtName;
      })[0];
      if (!feature) return false;
      var center = L.geoJSON(feature).getBounds().getCenter();
      map.flyTo(center, 14, { duration: 1.2 });
      if (window.villageMarker) map.removeLayer(window.villageMarker);
      window.villageMarker = L.marker(center).addTo(map)
        .bindPopup('<b style="color:#1a8a9e">' + (feature.properties.village_name || 'Unnamed') + '</b><br/>' +
          '<span style="font-size:0.65rem;color:#5a6a7a">' + districtName + ' District</span>')
        .openPopup();
      return true;
    });
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
      districtsGeoData = districtsGeo;

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
        // Always clear any state/district/village outline this module drew
        // (e.g. from a previous non-MP selection) before either path runs,
        // so it never lingers under the MP flow's own village layer.
        clearNationalHighlight();
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

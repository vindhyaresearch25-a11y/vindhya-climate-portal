/*
 * national_selector.js — VINDHYA Climate Portal
 *
 * Unified national Country -> State -> District -> Block/Tehsil -> Village
 * selector. Every state, Madhya Pradesh included, goes through the exact
 * same code path: boundary geometry and names all come from Survey of
 * India (via NWDP, see dashboard/data/boundaries/soi/), fetched lazily one
 * level at a time. Never dissolved from village polygons -- state,
 * district and block/tehsil (SoI's sub-district/sdcode product, the
 * closest real SoI match to "Block/Tehsil"; SoI's own block/bkcode has no
 * separate boundary product) are each their own real SoI dataset.
 *
 * MP_DISTRICTS (defined in index.html) is consulted in exactly ONE place
 * in this file -- mpRealDataKey() below -- purely to decide whether a
 * selected district has real IMD-derived climate data to layer on top via
 * index.html's applyDistrictMetrics/updateAdvisories. It plays no role in
 * boundary geometry, district naming, or dropdown population, all of
 * which are identical for every state including MP.
 *
 * No default state. The portal opens showing all of India; nothing is
 * selected until the user picks one, via a dropdown or a map click.
 */
(function () {
  'use strict';

  var REAL_DATA_DISTRICTS = { bhopal: 1, indore: 1, jabalpur: 1, rewa: 1, sidhi: 1 };
  var FETCH_TIMEOUT_MS = 30000;

  var statesGeo = null;
  var districtsGeo = null;
  var blocksCache = {};      // state_slug -> parsed blocks/<slug>.geojson
  var blocksInflight = {};
  var villagesCache = {};    // "state_slug/district_slug" -> parsed villages file
  var villagesInflight = {};

  var current = { state: null, district: null, block: null, village: null };
  var mapLayers = { state: null, district: null, block: null, village: null };
  var marker = null;
  // Captured in boot(): index.html's real per-village IMD data handler
  // (name-keyed, via MP_DISTRICTS[key]._villages), possibly further
  // wrapped by other loaders. Called from selectVillage below, only for
  // the 5 real districts, with the village's real name resolved from the
  // SoI feature -- the new Village dropdown's option values are vil_lgd
  // codes now (uniform across every state), not names, so this can't be
  // reached by just forwarding the dropdown's raw value anymore.
  var originalOnVillageChangeFn = null;

  var STYLE = {
    state:    { color: '#FF9500', weight: 4,   casingWeight: 7 },
    district: { color: '#00E5FF', weight: 3,   casingWeight: 6 },
    block:    { color: '#FF3DFF', weight: 2.5, casingWeight: 5 },
    village:  { color: '#C6FF00', weight: 2,   casingWeight: 4 }
  };
  var CASING_COLOR = '#000000';
  var CASING_OPACITY = 0.6;
  var FAINT_OPACITY = 0.4;

  function el(id) { return document.getElementById(id); }
  function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  // ---------------------------------------------------------------------
  // Fetch helpers: 30s timeout, in-memory cache, de-duped concurrent
  // requests, never throws -- a failed/slow fetch degrades to "no layer
  // this time", the rest of the page stays usable. See dashboard/data/
  // boundaries/README.md for what each file actually contains.
  // ---------------------------------------------------------------------
  function fetchWithTimeout(url) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        console.warn('[national_selector] fetch failed:', url, e);
        return null;
      });
  }

  function showStatus(msg) {
    var box = el('boundaryLoadStatus');
    if (!box) return;
    box.innerHTML = msg;
    box.style.display = 'block';
  }
  function hideStatus() {
    var box = el('boundaryLoadStatus');
    if (box) box.style.display = 'none';
  }

  // Every fetch below is split at 'data/boundaries/' as its own closed
  // string literal (not folded into one longer literal) so app.py's
  // Streamlit-deployment URL patcher -- which only matches that exact
  // literal -- still rewrites these to the GitHub raw CDN. See
  // scripts/build_soi_village_layer.py's identical convention/comment.
  function loadStatesGeo() {
    if (statesGeo) return Promise.resolve(statesGeo);
    return fetchWithTimeout('data/boundaries/' + 'soi/states.geojson').then(function (d) { statesGeo = d; return d; });
  }
  function loadDistrictsGeo() {
    if (districtsGeo) return Promise.resolve(districtsGeo);
    return fetchWithTimeout('data/boundaries/' + 'soi/districts.geojson').then(function (d) { districtsGeo = d; return d; });
  }
  function loadBlocksForState(stateSlug) {
    if (blocksCache[stateSlug]) return Promise.resolve(blocksCache[stateSlug]);
    if (blocksInflight[stateSlug]) return blocksInflight[stateSlug];
    showStatus('<i class="fa fa-spinner fa-spin"></i> Blocks/Tehsils loading&hellip;');
    var p = fetchWithTimeout('data/boundaries/' + 'soi/blocks/' + stateSlug + '.geojson')
      .then(function (d) { blocksCache[stateSlug] = d; hideStatus(); return d; })
      .finally(function () { delete blocksInflight[stateSlug]; });
    blocksInflight[stateSlug] = p;
    return p;
  }
  function loadVillagesForDistrict(stateSlug, districtSlug) {
    var key = stateSlug + '/' + districtSlug;
    if (villagesCache[key]) return Promise.resolve(villagesCache[key]);
    if (villagesInflight[key]) return villagesInflight[key];
    showStatus('<i class="fa fa-spinner fa-spin"></i> Villages loading&hellip;');
    var p = fetchWithTimeout('data/boundaries/' + 'soi/villages/' + stateSlug + '/' + districtSlug + '.geojson')
      .then(function (d) { villagesCache[key] = d; hideStatus(); return d; })
      .finally(function () { delete villagesInflight[key]; });
    villagesInflight[key] = p;
    return p;
  }

  // ---------------------------------------------------------------------
  // Casing-technique rendering: a black underlay (weight+3, opacity 0.6)
  // beneath a bright, thin line on top, fill:false so the satellite
  // basemap stays visible. Only the single currently-selected feature at
  // each level is drawn (not every sibling) -- picking a new level
  // replaces that level's layer; the parent level's layer is dimmed to
  // FAINT_OPACITY rather than removed, so the drill-down path stays
  // visible; child levels below the one just picked are cleared, so no
  // stale selection from a previous drill-down ever lingers.
  // ---------------------------------------------------------------------
  function drawCasedFeature(level, feature, onClick) {
    var map = window.leafletMap;
    if (!map || !feature) return null;
    var s = STYLE[level];
    var group = L.layerGroup();
    var casing = L.geoJSON(feature, { style: { color: CASING_COLOR, weight: s.casingWeight, opacity: CASING_OPACITY, fill: false } });
    var bright = L.geoJSON(feature, { style: { color: s.color, weight: s.weight, opacity: 1, fill: false } });
    casing.addTo(group);
    bright.addTo(group);
    if (onClick) {
      bright.on('click', onClick);
      casing.on('click', onClick);
    }
    group.addTo(map);
    return group;
  }

  function setLayerOpacity(group, opacity) {
    if (!group) return;
    group.eachLayer(function (sub) {
      if (sub.setStyle) sub.setStyle({ opacity: opacity });
      else if (sub.eachLayer) sub.eachLayer(function (l) { if (l.setStyle) l.setStyle({ opacity: opacity }); });
    });
  }

  function removeLayer(level) {
    var map = window.leafletMap;
    if (mapLayers[level] && map) map.removeLayer(mapLayers[level]);
    mapLayers[level] = null;
  }
  function fadeParents(exceptLevel) {
    var order = ['state', 'district', 'block', 'village'];
    var idx = order.indexOf(exceptLevel);
    order.forEach(function (lvl, i) {
      if (i < idx && mapLayers[lvl]) setLayerOpacity(mapLayers[lvl], FAINT_OPACITY);
      if (i === idx && mapLayers[lvl]) setLayerOpacity(mapLayers[lvl], 1);
    });
  }
  function clearBelow(level) {
    var order = ['state', 'district', 'block', 'village'];
    var idx = order.indexOf(level);
    for (var i = idx + 1; i < order.length; i++) removeLayer(order[i]);
    if (marker && window.leafletMap && idx < order.indexOf('village')) {
      window.leafletMap.removeLayer(marker);
      marker = null;
    }
  }

  function fitToFeature(feature) {
    var map = window.leafletMap;
    if (!map || !feature) return;
    try {
      var b = L.geoJSON(feature).getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
    } catch (e) { /* ignore malformed bounds */ }
  }

  // ---------------------------------------------------------------------
  // Dropdown population
  // ---------------------------------------------------------------------
  function fillSelect(selectEl, options, placeholder) {
    selectEl.innerHTML = '';
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    selectEl.appendChild(ph);
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      selectEl.appendChild(opt);
    });
  }

  function resetDownstreamFrom(level) {
    if (level === 'state') {
      var d = el('districtSelect'); if (d) fillSelect(d, [], '-- Select State First --');
    }
    if (level === 'state' || level === 'district') {
      var b = el('blockSelect'); var bf = el('blockField');
      if (b) fillSelect(b, [], '-- Select District First --');
      if (bf) bf.style.display = 'none';
    }
    if (level === 'state' || level === 'district' || level === 'block') {
      var v = el('villageSelect'); var vf = el('villageField');
      if (v) fillSelect(v, [], '-- Select Block First --');
      if (vf) vf.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------
  // Breadcrumb + "not available" climate baseline. Real data (for the 5
  // MP_DISTRICTS with live IMD indices) is layered on top of this from
  // window.onDistrictChange's dispatcher below -- see mpRealDataKey().
  // ---------------------------------------------------------------------
  function updateBreadcrumb() {
    var parts = ['<b>India</b>'];
    if (current.state) parts.push('<b>' + current.state + '</b>');
    if (current.district) parts.push('<b>' + current.district + '</b>');
    if (current.block) parts.push('<b>' + current.block + '</b>');
    if (current.village) parts.push('<b>' + current.village + '</b>');
    var bc = el('locBreadcrumb');
    if (bc) bc.innerHTML = parts.join(' &rsaquo; ');
  }

  function resetClimateToNotAvailable(label) {
    var NA = 'Not available';
    ['m-drought', 'm-heat', 'm-rain', 'm-soil', 'm-ndvi', 'm-crop', 'm-gw'].forEach(function (id) {
      var e = el(id); if (e) e.textContent = NA;
    });
    ['bar-drought', 'bar-heat', 'bar-rain', 'bar-ndvi', 'bar-crop', 'bar-gw'].forEach(function (id) {
      var e = el(id); if (e) e.style.width = '0%';
    });
    // Sub-labels under the Heatwave Severity / Rainfall Departure cards
    // (e.g. "42.5°C Acharpura") aren't covered by the m-* ids above and
    // are only ever set by index.html's applyDistrictMetrics, which isn't
    // called for a non-real district -- reset them explicitly here or a
    // previously-selected real district/village's label survives the
    // switch to a state/district with no data.
    var heatDetail = el('heat-detail'); if (heatDetail) heatDetail.textContent = 'Select a district';
    var rainTrend = el('m-rain-trend'); if (rainTrend) rainTrend.textContent = 'Select a district';
    var advTitle = el('adv-title-0');
    if (advTitle) advTitle.textContent = 'Data not yet available for ' + label;
    var advBody = el('adv-body-0');
    if (advBody) advBody.textContent = 'Climate data for ' + label + ' is not yet available. IMD-derived indices are currently computed for Bhopal, Indore, Jabalpur, Rewa and Sidhi (Madhya Pradesh) only.';
    var navBadgeHeat = el('nav-badge-heat');
    if (navBadgeHeat) navBadgeHeat.style.display = 'none';
    // Clear every panel mp_climate_loader.js owns (historical/village/
    // future-2040 indices, charts, agri/eco district-name headers, the
    // village marker) so no data from a previously-selected real MP
    // district or village survives this switch.
    if (typeof window._mpClimateClear === 'function') window._mpClimateClear();
  }

  // The ONE place MP_DISTRICTS is consulted: resolves a district's real
  // name (from the SoI dropdown, same for every state) to the lowercase
  // MP_DISTRICTS key, only if it's one of the 5 with real IMD data.
  function mpRealDataKey(districtName) {
    if (!districtName) return null;
    var key = districtName.trim().toLowerCase();
    return (typeof MP_DISTRICTS !== 'undefined' && MP_DISTRICTS[key] && REAL_DATA_DISTRICTS[key]) ? key : null;
  }

  // ---------------------------------------------------------------------
  // Selection handlers -- each one is reachable both from a dropdown's
  // onchange AND from clicking the corresponding polygon on the map, so
  // the two stay in sync by construction (same function, same effect).
  // ---------------------------------------------------------------------
  function selectState(stateName, fromMap) {
    current.state = stateName || null;
    current.district = null; current.block = null; current.village = null;
    clearBelow('state');
    resetDownstreamFrom('state');
    if (!stateName) { removeLayer('state'); updateBreadcrumb(); return; }

    var sel = el('stateSelect');
    if (sel && sel.value !== stateName) sel.value = stateName;

    loadStatesGeo().then(function (geo) {
      if (!geo) return;
      var feature = geo.features.filter(function (f) { return f.properties && f.properties.state_name === stateName; })[0];
      removeLayer('state');
      mapLayers.state = drawCasedFeature('state', feature, function () { selectState(stateName, true); });
      fitToFeature(feature);
    });

    loadDistrictsGeo().then(function (geo) {
      if (!geo) return;
      var districts = geo.features
        .filter(function (f) { return f.properties && f.properties.state_name === stateName; })
        .map(function (f) { return f.properties.district_name; })
        .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; })
        .sort();
      var distSel = el('districtSelect');
      if (distSel) fillSelect(distSel, districts.map(function (d) { return { value: d, label: d }; }), '-- Select District --');
    });

    // Prefetch this state's blocks -- needed the moment a district is picked.
    loadBlocksForState(slugify(stateName));

    resetClimateToNotAvailable(stateName);
    updateBreadcrumb();
  }

  function selectDistrict(districtName, fromMap) {
    if (!current.state) return;
    current.district = districtName || null;
    current.block = null; current.village = null;
    clearBelow('district');
    resetDownstreamFrom('district');
    if (!districtName) { removeLayer('district'); updateBreadcrumb(); return; }

    var sel = el('districtSelect');
    if (sel && sel.value !== districtName) sel.value = districtName;

    loadDistrictsGeo().then(function (geo) {
      if (!geo) return;
      var feature = geo.features.filter(function (f) {
        return f.properties && f.properties.state_name === current.state && f.properties.district_name === districtName;
      })[0];
      removeLayer('district');
      mapLayers.district = drawCasedFeature('district', feature, function () { selectDistrict(districtName, true); });
      fadeParents('district');
      fitToFeature(feature);
    });

    var stateSlug = slugify(current.state);
    loadBlocksForState(stateSlug).then(function (geo) {
      if (!geo) return;
      var blocks = geo.features
        .filter(function (f) { return f.properties && f.properties.district_name === districtName; })
        .map(function (f) { return f.properties.block_name; })
        .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; })
        .sort();
      var blockSel = el('blockSelect');
      var blockField = el('blockField');
      if (blockSel) fillSelect(blockSel, blocks.map(function (b) { return { value: b, label: b }; }), '-- Select Block/Tehsil --');
      if (blockField) blockField.style.display = 'block';
    });

    // Prefetch this district's villages -- needed once a block is picked.
    loadVillagesForDistrict(stateSlug, slugify(districtName));

    if (!mpRealDataKey(districtName)) {
      resetClimateToNotAvailable(districtName);
    }
    // Real IMD climate data (for the 5 MP_DISTRICTS) is layered on top by
    // window.onDistrictChange's dispatcher in boot() below, which calls
    // this function first unconditionally and then, only for a real
    // district, calls the original index.html onDistrictChange (still
    // named that, not renamed, so mp_climate_loader.js's and
    // dicra_ndvi_loader.js's own wrapping -- which looks for a function
    // literally called onDistrictChange -- keeps finding it reliably).
    updateBreadcrumb();
  }

  function selectBlock(blockName, fromMap) {
    if (!current.district) return;
    current.block = blockName || null;
    current.village = null;
    clearBelow('block');
    resetDownstreamFrom('block');
    if (!blockName) { removeLayer('block'); updateBreadcrumb(); return; }

    var sel = el('blockSelect');
    if (sel && sel.value !== blockName) sel.value = blockName;

    var stateSlug = slugify(current.state);
    loadBlocksForState(stateSlug).then(function (geo) {
      if (!geo) return;
      var feature = geo.features.filter(function (f) {
        return f.properties && f.properties.district_name === current.district && f.properties.block_name === blockName;
      })[0];
      removeLayer('block');
      mapLayers.block = drawCasedFeature('block', feature, function () { selectBlock(blockName, true); });
      fadeParents('block');
      fitToFeature(feature);
    });

    loadVillagesForDistrict(stateSlug, slugify(current.district)).then(function (geo) {
      if (!geo) return;
      var villages = geo.features
        .filter(function (f) { return f.properties && (f.properties.block_name === blockName || f.properties.subdistrict_name === blockName); })
        .map(function (f) { return { value: String(f.properties.vil_lgd), label: f.properties.village_name }; })
        .filter(function (v) { return v.label && v.label.trim(); })
        .sort(function (a, b) { return a.label.localeCompare(b.label); });
      var villSel = el('villageSelect');
      var villField = el('villageField');
      if (villSel) fillSelect(villSel, villages, villages.length ? '-- Select Village --' : 'Data pending for this area');
      if (villField) villField.style.display = 'block';
    });

    updateBreadcrumb();
  }

  function selectVillage(vilLgd, fromMap) {
    if (!current.block) return;
    current.village = vilLgd || null;
    clearBelow('village');
    if (!vilLgd) { removeLayer('village'); updateBreadcrumb(); return; }

    var sel = el('villageSelect');
    if (sel && sel.value !== String(vilLgd)) sel.value = String(vilLgd);

    var stateSlug = slugify(current.state);
    loadVillagesForDistrict(stateSlug, slugify(current.district)).then(function (geo) {
      var map = window.leafletMap;
      if (!geo || !map) return;
      var feature = geo.features.filter(function (f) { return f.properties && String(f.properties.vil_lgd) === String(vilLgd); })[0];
      if (!feature) return;
      var name = feature.properties.village_name || 'Unnamed';
      removeLayer('village');
      mapLayers.village = drawCasedFeature('village', feature, function () { selectVillage(vilLgd, true); });
      mapLayers.village.eachLayer(function (sub) {
        sub.bindPopup ? sub.bindPopup(popupHtml(name, feature.properties)) :
          (sub.eachLayer && sub.eachLayer(function (l) { if (l.bindPopup) l.bindPopup(popupHtml(name, feature.properties)); }));
      });
      fadeParents('village');
      fitToFeature(feature);
      current.village = name;
      // Real per-village climate data (index.html's onVillageChange) is
      // applied BEFORE this module's own updateBreadcrumb() runs, not
      // after -- index.html's onVillageChange ends with its own call to
      // its own updateBreadcrumb(), which reads villageSelect's raw value
      // (the vil_lgd code, not the name) and would otherwise overwrite the
      // correct name-based breadcrumb set here with that code.
      var mpKey = mpRealDataKey(current.district);
      if (mpKey) {
        if (typeof originalOnVillageChangeFn === 'function') originalOnVillageChangeFn(name);
        // Explicit, correctly-timed call for the Historical Indices panel
        // (mp_climate_loader.js) -- see window._mpClimateRefreshVillage's
        // own comment for why its generic window.onVillageChange wrapper
        // can't do this reliably itself.
        if (typeof window._mpClimateRefreshVillage === 'function') window._mpClimateRefreshVillage(mpKey, name);
      }
      updateBreadcrumb();
    });
  }

  function popupHtml(name, props) {
    return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;min-width:170px">' +
      '<b style="color:var(--cyan)">' + name + '</b><br>' +
      '<span style="font-size:0.62rem;color:#5a6a7a">' + (current.block || '') + ' &rsaquo; ' + (current.district || '') + '</span><br>' +
      '<span style="font-size:0.6rem;color:#8a8a8a">src_agency: Survey of India (SOI)</span>' +
      '</div>';
  }

  // ---------------------------------------------------------------------
  // Boot: load the state list (names only, cheap) and wire every dropdown
  // + the public window.onDistrictChange/onVillageChange dispatcher that
  // mp_climate_loader.js and dicra_ndvi_loader.js also wrap (in whichever
  // order their own async init reaches this point) to layer real IMD data
  // on top for the 5 MP_DISTRICTS. No state is pre-selected.
  // ---------------------------------------------------------------------
  function populateStateSelect() {
    loadStatesGeo().then(function (geo) {
      if (!geo) return;
      var sel = el('stateSelect');
      if (!sel) return;
      var names = geo.features.map(function (f) { return f.properties.state_name; }).sort();
      fillSelect(sel, names.map(function (n) { return { value: n, label: n }; }), '-- Select State --');
      sel.disabled = false;
      sel.onchange = function () { selectState(this.value); };
    });
  }

  function unlockSelector() {
    var country = el('countrySelect');
    if (country) country.disabled = false;
    document.querySelectorAll('.loc-field.locked .loc-lock-icon').forEach(function (i) { i.remove(); });
    document.querySelectorAll('.loc-field.locked').forEach(function (f) { f.classList.remove('locked'); });
  }

  function boot() {
    unlockSelector();
    populateStateSelect();
    var adv0t = el('adv-title-0'); if (adv0t) adv0t.textContent = 'Select a state to begin';
    var adv0b = el('adv-body-0'); if (adv0b) adv0b.textContent = 'Boundaries and village profiles are available for every state. IMD-derived climate indices are currently computed for Bhopal, Indore, Jabalpur, Rewa and Sidhi (Madhya Pradesh) only.';

    // districtSelect and villageSelect already have inline
    // onchange="onDistrictChange(this.value)" / "onVillageChange(this.value)"
    // in index.html, which must keep going through window.onDistrictChange/
    // onVillageChange (wired below) rather than being overridden with a
    // direct .onchange assignment here -- that's what lets
    // mp_climate_loader.js's and dicra_ndvi_loader.js's own wrapping of
    // those two globals keep working for the 5 real districts. blockSelect
    // has no such external wrapping, so it's simplest to just replace the
    // global onBlockChange function it already calls inline.
    window.onBlockChange = function (blockName) { selectBlock(blockName); };

    // index.html's onchange="onDistrictChange(this.value)" calls
    // window.onDistrictChange directly -- the .onchange assignments above
    // are for the raw <select> elements, this is for that inline handler,
    // which mp_climate_loader.js and dicra_ndvi_loader.js ALSO wrap
    // (whichever of the three of us finishes our own async init first
    // wraps whatever's there; order isn't guaranteed, so this must compose
    // with whatever's already assigned rather than assume it runs first
    // or last). Capture whatever's there now, then always run the
    // boundary+dropdown update first, and only for one of the 5 real
    // districts also call the captured original (index.html's real-data
    // application, itself possibly already wrapped with mp_climate_loader's
    // chart rebuild and dicra's NDVI update).
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      selectDistrict(distKey);
      var mpKey = mpRealDataKey(distKey);
      if (mpKey && typeof originalOnDistrictChange === 'function') {
        originalOnDistrictChange(mpKey);
      }
    };
    // Village-level real IMD data: capture whatever's assigned now (index.html's
    // name-keyed handler, possibly further wrapped) so selectVillage can call
    // it with the resolved real village name once a real district's village
    // feature loads -- see originalOnVillageChangeFn above.
    originalOnVillageChangeFn = window.onVillageChange;
    window.onVillageChange = function (village) {
      selectVillage(village);
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 50);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
  }
})();

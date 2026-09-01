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
  var villageProfileCache = {};    // "state_slug/district_slug" -> parsed village_profiles file
  var villageProfileInflight = {};

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

  // Two palettes (FINAL_PROMPT.md Phase 5.2): dark basemaps (Satellite,
  // Dark Matter, Terrain) use a black underlay + neon lines; light
  // basemaps (OSM Street, Carto Positron) invert to a white underlay +
  // deep lines so the casing stays legible against a pale background.
  // setBoundaryTheme() below swaps both live, restyling any already-drawn
  // layers in place rather than requiring a redraw.
  var STYLE_DARK = {
    state:    { color: '#FF9500', weight: 4,   casingWeight: 7 },
    district: { color: '#00E5FF', weight: 3,   casingWeight: 6 },
    block:    { color: '#FF3DFF', weight: 2.5, casingWeight: 5 },
    village:  { color: '#C6FF00', weight: 2,   casingWeight: 4 }
  };
  var STYLE_LIGHT = {
    state:    { color: '#B45309', weight: 4,   casingWeight: 7 },
    district: { color: '#0E7490', weight: 3,   casingWeight: 6 },
    block:    { color: '#A21CAF', weight: 2.5, casingWeight: 5 },
    village:  { color: '#4D7C0F', weight: 2,   casingWeight: 4 }
  };
  var STYLE = STYLE_DARK;
  var CASING_COLOR = '#000000';
  var CASING_OPACITY = 0.6;
  // AUDIT_FIX_PROMPT.md item 3/20 (owner report, twice): the state
  // boundary's edges span the full viewport once you're zoomed into one
  // small district inside it -- even at the old 0.4 opacity, those long
  // straight-ish lines (casing black + bright orange) read as a "grid"
  // crossing the whole map, not as a subtle parent-context cue. Lowered
  // so the drill-down breadcrumb (the actual reason this layer stays
  // instead of being removed, see the comment above) is still faintly
  // there up close but no longer reads as an unwanted grid pattern.
  var FAINT_OPACITY = 0.12;
  var boundaryTheme = 'dark';

  function setBoundaryTheme(theme) {
    theme = (theme === 'light') ? 'light' : 'dark';
    if (theme === boundaryTheme) return;
    boundaryTheme = theme;
    STYLE = (theme === 'light') ? STYLE_LIGHT : STYLE_DARK;
    CASING_COLOR = (theme === 'light') ? '#FFFFFF' : '#000000';
    ['state', 'district', 'block', 'village'].forEach(function (level) {
      var group = mapLayers[level];
      if (!group || !group._casingLayer || !group._brightLayer) return;
      var s = STYLE[level];
      group._casingLayer.setStyle({ color: CASING_COLOR, weight: s.casingWeight });
      group._brightLayer.setStyle({ color: s.color, weight: s.weight });
    });
  }
  window.setBoundaryTheme = setBoundaryTheme;

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
  //
  // resolveDataUrl() (defined in index.html, loaded before this file --
  // see the dynamic <script> append there) additionally rewrites the
  // 'data/boundaries/...' and 'data/village_profiles/...' paths to the
  // Hugging Face-hosted copy on GitHub Pages, per config/data_config.json.
  // On Streamlit, app.py has already replaced the literal with an
  // absolute githubusercontent URL by the time this runs, and
  // resolveDataUrl() passes any already-absolute URL through unchanged --
  // the two rewrites compose without double-prefixing either way.
  function loadStatesGeo() {
    if (statesGeo) return Promise.resolve(statesGeo);
    return fetchWithTimeout(resolveDataUrl('data/boundaries/' + 'soi/states.geojson')).then(function (d) { statesGeo = d; return d; });
  }
  function loadDistrictsGeo() {
    if (districtsGeo) return Promise.resolve(districtsGeo);
    return fetchWithTimeout(resolveDataUrl('data/boundaries/' + 'soi/districts.geojson')).then(function (d) { districtsGeo = d; return d; });
  }
  function loadBlocksForState(stateSlug) {
    if (blocksCache[stateSlug]) return Promise.resolve(blocksCache[stateSlug]);
    if (blocksInflight[stateSlug]) return blocksInflight[stateSlug];
    showStatus('<i class="fa fa-spinner fa-spin"></i> Blocks/Tehsils loading&hellip;');
    var p = fetchWithTimeout(resolveDataUrl('data/boundaries/' + 'soi/blocks/' + stateSlug + '.geojson'))
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
    var p = fetchWithTimeout(resolveDataUrl('data/boundaries/' + 'soi/villages/' + stateSlug + '/' + districtSlug + '.geojson'))
      .then(function (d) { villagesCache[key] = d; hideStatus(); return d; })
      .finally(function () { delete villagesInflight[key]; });
    villagesInflight[key] = p;
    return p;
  }

  function loadVillageProfilesForDistrict(stateSlug, districtSlug) {
    var key = stateSlug + '/' + districtSlug;
    if (villageProfileCache[key]) return Promise.resolve(villageProfileCache[key]);
    if (villageProfileInflight[key]) return villageProfileInflight[key];
    var p = fetchWithTimeout(resolveDataUrl('data/' + 'village_profiles/' + stateSlug + '/' + districtSlug + '.json'))
      .then(function (d) { villageProfileCache[key] = d; return d; })
      .catch(function () { villageProfileCache[key] = null; return null; })
      .finally(function () { delete villageProfileInflight[key]; });
    villageProfileInflight[key] = p;
    return p;
  }

  var WATER_SOURCE_LABELS = {
    water_tapwater_treated: 'Treated tap water', water_tapwater_untreated: 'Untreated tap water',
    water_covered_well: 'Covered well', water_uncovered_well: 'Uncovered well',
    water_handpump: 'Handpump', water_tubewell_borehole: 'Tubewell/borehole',
    water_spring: 'Spring', water_river_canal: 'River/canal', water_tank_pond_lake: 'Tank/pond/lake',
    water_other_source: 'Other source'
  };

  function fmtNum(v) { return (v === null || v === undefined) ? '—' : Number(v).toLocaleString('en-IN'); }

  // STANDING ORDERS #6: village profile (population, households, net area
  // sown, irrigation, water sources, nearest town) shown for the WHOLE
  // country, separate from climate data (which stays IMD-district-only).
  // A field absent from this village's row (per build_village_profiles.py,
  // meaning the source itself left it blank) is never shown as 0 or
  // guessed -- it's just left out of its section.
  function renderVillageProfile(stateSlug, districtSlug, vilLgd, displayName) {
    var host = el('pane-village');
    if (!host) return;
    loadVillageProfilesForDistrict(stateSlug, districtSlug).then(function (payload) {
      if (!payload || !payload.metadata || !payload.metadata.field_order) {
        host.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;">' +
          'Village profile data not available for this district.</div>';
        return;
      }
      var row = payload.villages[String(vilLgd)];
      if (!row) {
        host.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;">' +
          'No Survey of India profile record for "' + displayName + '" (village boundary and name are still real -- ' +
          'this specific village\'s row was dropped upstream, e.g. an unreadable LGD code).</div>';
        return;
      }
      var order = payload.metadata.field_order;
      var v = {};
      for (var i = 0; i < order.length; i++) v[order[i]] = row[i] !== undefined ? row[i] : null;

      var waterRows = Object.keys(WATER_SOURCE_LABELS)
        .filter(function (k) { return v[k] === 1; })
        .map(function (k) { return '<span style="display:inline-block;background:rgba(26,138,158,0.1);color:var(--cyan);' +
          'border-radius:10px;padding:0.15rem 0.55rem;font-size:0.62rem;font-weight:600;margin:0.15rem 0.25rem 0.15rem 0;">' +
          WATER_SOURCE_LABELS[k] + '</span>'; }).join('');

      var irrigationSources = [
        ['Canals', v.irrigated_canals_ha], ['Wells/tubewells', v.irrigated_wells_tubewells_ha],
        ['Tanks/lakes', v.irrigated_tanks_lakes_ha], ['Waterfall', v.irrigated_waterfall_ha],
        ['Other', v.irrigated_other_ha]
      ].filter(function (p) { return p[1] !== null && p[1] > 0; });

      function metric(label, value, color) {
        return '<div class="metric-card" style="flex:1;min-width:110px;"><div class="metric-label">' + label +
          '</div><div class="metric-value" style="font-size:0.85rem;color:' + (color || 'var(--text)') + '">' + value + '</div></div>';
      }

      var html = '<div class="section-header"><i class="fa fa-house" style="color:var(--cyan);font-size:0.7rem"></i>' +
        '<div class="section-title">VILLAGE PROFILE &mdash; ' + displayName + '</div></div>' +
        '<div style="overflow-y:auto;flex:1;padding:0.5rem;">' +
        '<div style="display:flex;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">' +
        metric('POPULATION', fmtNum(v.population), 'var(--green)') +
        metric('HOUSEHOLDS', fmtNum(v.households), 'var(--cyan)') +
        metric('AVG. HOUSEHOLD SIZE', v.avg_household_size !== null ? v.avg_household_size : '—', 'var(--teal)') +
        metric('MALE / FEMALE', fmtNum(v.population_male) + ' / ' + fmtNum(v.population_female), 'var(--yellow)') +
        '</div>';

      if (waterRows) {
        html += '<div class="section-header" style="padding:0.25rem 0;margin-bottom:0.3rem;"><i class="fa fa-droplet" ' +
          'style="color:var(--blue);font-size:0.7rem"></i><div class="section-title" style="font-size:0.7rem">DRINKING WATER SOURCES</div></div>' +
          '<div style="margin-bottom:0.6rem;">' + waterRows + '</div>';
      }

      if (v.land_net_area_sown_ha !== null) {
        html += '<div class="section-header" style="padding:0.25rem 0;margin-bottom:0.3rem;"><i class="fa fa-wheat-awn" ' +
          'style="color:var(--green);font-size:0.7rem"></i><div class="section-title" style="font-size:0.7rem">LAND USE (hectares)</div></div>' +
          '<div style="display:flex;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">' +
          metric('NET AREA SOWN', fmtNum(v.land_net_area_sown_ha), 'var(--green)') +
          metric('CURRENT FALLOW', fmtNum(v.land_fallow_current_ha)) +
          metric('FOREST', fmtNum(v.land_forest_ha)) +
          metric('BARREN/UNCULTIVABLE', fmtNum(v.land_barren_uncultivable_ha)) +
          metric('PASTURES', fmtNum(v.land_pastures_ha)) +
          '</div>';
      }

      if (v.irrigated_area_total_ha !== null) {
        html += '<div class="section-header" style="padding:0.25rem 0;margin-bottom:0.3rem;"><i class="fa fa-faucet-drip" ' +
          'style="color:var(--cyan);font-size:0.7rem"></i><div class="section-title" style="font-size:0.7rem">IRRIGATION</div></div>' +
          '<div style="display:flex;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">' +
          metric('IRRIGATED AREA', fmtNum(v.irrigated_area_total_ha) + ' ha', 'var(--cyan)') +
          metric('UNIRRIGATED', fmtNum(v.land_unirrigated_ha) + ' ha');
        irrigationSources.forEach(function (p) { html += metric(p[0].toUpperCase(), fmtNum(p[1]) + ' ha'); });
        html += '</div>';
      }

      if (v.nearest_town) {
        html += '<div class="section-header" style="padding:0.25rem 0;margin-bottom:0.3rem;"><i class="fa fa-signs-post" ' +
          'style="color:var(--orange);font-size:0.7rem"></i><div class="section-title" style="font-size:0.7rem">NEAREST TOWN</div></div>' +
          '<div style="font-size:0.75rem;color:var(--text);margin-bottom:0.4rem;">' + v.nearest_town +
          (v.nearest_town_distance_km !== null ? ' (' + v.nearest_town_distance_km + ' km)' : '') + '</div>';
      }

      html += '<div style="font-size:0.58rem;color:var(--text-dim);margin-top:0.5rem;padding-top:0.4rem;border-top:1px solid var(--border);">' +
        'Source: Survey of India village-boundary attribute table, via National Water Data Portal. A field not shown here ' +
        'was left blank in the source, never estimated.</div>' +
        '</div>';
      host.innerHTML = html;
    });
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
  // BUG (reported live): the village marker used a separate, hand-typed
  // per-village lat/lon table (MP_DISTRICTS[key]._villages in index.html),
  // independent of the actual boundary polygon drawn on the map -- easy
  // for the two to disagree, and did nothing at all for the other 35
  // states since that table only ever existed for the 5 MP_DISTRICTS.
  // Fix: the marker is now built from the SAME GeoJSON feature drawn by
  // drawCasedFeature, every time, at all four levels -- no separate
  // table. turf.pointOnFeature (not a centroid) guarantees the point
  // lands inside the polygon even for concave/multi-part shapes where a
  // simple centroid can fall outside it entirely.
  function placeMarker(feature) {
    var map = window.leafletMap;
    if (!map || !feature || typeof turf === 'undefined') return;
    if (marker) { map.removeLayer(marker); marker = null; }
    try {
      var pt = turf.pointOnFeature(feature);
      var coords = pt.geometry.coordinates; // [lng, lat]
      marker = L.marker([coords[1], coords[0]]).addTo(map);
      // Exposed for other loaders that need a real point inside the
      // current selection (e.g. live_weather_loader.js's NASA POWER
      // point query) without each reimplementing turf.pointOnFeature --
      // same guarantee placeMarker itself relies on: lands inside the
      // polygon even for concave/multi-part shapes, unlike a naive centroid.
      window.currentLocationPoint = { lat: coords[1], lon: coords[0] };
    } catch (e) {
      console.warn('[national_selector] placeMarker: turf.pointOnFeature failed, no marker shown', e);
      window.currentLocationPoint = null;
    }
  }

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
    group._casingLayer = casing;
    group._brightLayer = bright;
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
    if (idx < order.indexOf('village')) {
      if (marker && window.leafletMap) { window.leafletMap.removeLayer(marker); marker = null; }
      resetVillageProfilePane();
    }
  }

  function resetVillageProfilePane() {
    var host = el('pane-village');
    if (!host) return;
    host.innerHTML = '<div class="section-header"><i class="fa fa-house" style="color:var(--cyan);font-size:0.7rem"></i>' +
      '<div class="section-title">VILLAGE INTELLIGENCE</div></div>' +
      '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;line-height:1.8;">' +
      '<i class="fa fa-house" style="font-size:26px;display:block;margin-bottom:8px;opacity:0.6"></i>' +
      '<b>Use the Location Selector</b><br>Select State &rarr; District &rarr; Block &rarr; Village on the map to see this ' +
      'village\'s Survey of India profile (population, households, water sources, land use, irrigation, nearest town).</div>';
  }

  function fitToFeature(feature) {
    var map = window.leafletMap;
    if (!map || !feature) return;
    try {
      var b = L.geoJSON(feature).getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
    } catch (e) { /* ignore malformed bounds */ }
  }

  // Exposed for exportMapPNG() (index.html, Phase 5.3 crop-to-selection
  // rewrite) -- returns the most specific currently-drawn level's real
  // bounds + GeoJSON feature (for a real turf.area() computation), never
  // a guessed/approximate box. null if nothing is selected (caller falls
  // back to the whole visible map, same as before this feature existed).
  function getCurrentSelectionBounds() {
    var order = ['village', 'block', 'district', 'state'];
    for (var i = 0; i < order.length; i++) {
      var lvl = order[i], group = mapLayers[lvl];
      if (!group || !group._brightLayer) continue;
      var b = group._brightLayer.getBounds();
      if (!b.isValid()) continue;
      var feature = null;
      try { feature = group._brightLayer.toGeoJSON(); } catch (e) { /* area stays null below */ }
      return { level: lvl, bounds: b, feature: feature };
    }
    return null;
  }
  window.getCurrentSelectionBounds = getCurrentSelectionBounds;

  // AUDIT_FIX_PROMPT.md item 0C part 2 (owner 2026-09-02): Climate Risk
  // Atlas/NDVI Analytics/Rainfall Monitor need an honest label naming which
  // admin level a number is actually at. Exposed so national_climate_loader.js,
  // national_ndvi_loader.js and index.html's own applyDistrictMetrics/
  // onVillageChange (all three own different real numbers for the same
  // district/block/village) can each compute the same suffix from the one
  // real selection state this file already tracks, instead of guessing it
  // independently and risking disagreement.
  function getCurrentSelection() {
    return { state: current.state, district: current.district, block: current.block, village: current.village };
  }
  window.getCurrentSelection = getCurrentSelection;

  // hasSpecificData: true if the caller is about to show a number that is
  // genuinely resolved at the CURRENT (deepest-selected) level -- e.g. a
  // real per-village IMD reading. false if the number being shown is really
  // the parent district's (or state's), just carried down because no deeper
  // real source exists. Never fabricates a number itself -- only chooses
  // the honest words to put next to whatever the caller already decided to
  // show.
  function climateLevelSuffix(hasSpecificData) {
    if (hasSpecificData) {
      if (current.village) return ' · village-level (real reading)';
      return '';
    }
    if (current.village) return ' · district-level estimate (no village-specific data)';
    if (current.block) return ' · district-level estimate (no block-specific data)';
    return '';
  }
  window.climateLevelSuffix = climateLevelSuffix;


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
    var droughtTrend = el('drought-trend'); if (droughtTrend) droughtTrend.textContent = 'Select a district';
    var ndviDetail = el('ndvi-detail'); if (ndviDetail) ndviDetail.textContent = 'Select a district';
    // adv-title-0/adv-body-0 resets removed 2026-08-14 alongside the
    // right-panel Farmer Advisory block itself (owner instruction).
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

  // BUG (reported live): stepping back up from a village to just its
  // block -- or deselecting a village outright -- left heat-detail/
  // m-rain-trend showing the village's name and numbers, because only
  // onVillageChange (index.html) ever WROTE those two labels; nothing
  // ever wrote them back to the district-level values selectVillage's
  // clearBelow('village') already restores everywhere else (the
  // dropdown, the marker, the village-profile pane). Every step of the
  // cascade must show real, current-level data, never a stale deeper
  // selection's numbers -- so wherever village-level state is cleared
  // without a new village replacing it, re-run the same district-level
  // metrics call onDistrictChange itself uses.
  function restoreDistrictMetricsIfReal() {
    var mpKey = mpRealDataKey(current.district);
    if (mpKey && typeof window.applyDistrictMetrics === 'function' && typeof MP_DISTRICTS !== 'undefined') {
      window.applyDistrictMetrics(MP_DISTRICTS[mpKey], mpKey);
    }
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
    if (!stateName) {
      removeLayer('state'); updateBreadcrumb();
      if (typeof window.onStateSelected === 'function') window.onStateSelected(null);
      return;
    }

    var sel = el('stateSelect');
    if (sel && sel.value !== stateName) sel.value = stateName;

    loadStatesGeo().then(function (geo) {
      if (!geo) return;
      var feature = geo.features.filter(function (f) { return f.properties && f.properties.state_name === stateName; })[0];
      removeLayer('state');
      mapLayers.state = drawCasedFeature('state', feature, function () { selectState(stateName, true); });
      placeMarker(feature);
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
    // AUDIT_FIX_PROMPT.md item 0C part 2: resetClimateToNotAvailable() above
    // always blanks the metric cards first (the safe default) -- this hook
    // lets state_aggregate_loader.js overwrite that with a REAL mean across
    // this state's own already-computed real districts, if any exist. If
    // none exist yet, the cards correctly stay "Not available".
    if (typeof window.onStateSelected === 'function') window.onStateSelected(stateName);
  }

  function selectDistrict(districtName, fromMap) {
    if (!current.state) return;
    current.district = districtName || null;
    current.block = null; current.village = null;
    clearBelow('district');
    resetDownstreamFrom('district');
    if (!districtName) {
      removeLayer('district'); resetClimateToNotAvailable(current.state); updateBreadcrumb();
      // Stepping back UP from a district to just its state (via the
      // District dropdown's own "-- Select District --" option, not the
      // State dropdown) must restore the STATE-level aggregate, not force
      // the same blank "Not available" a fresh state pick briefly shows --
      // same principle as restoreDistrictMetricsIfReal() below for
      // block/village step-back, applied one level up.
      if (typeof window.onStateSelected === 'function') window.onStateSelected(current.state);
      return;
    }

    var sel = el('districtSelect');
    if (sel && sel.value !== districtName) sel.value = districtName;

    loadDistrictsGeo().then(function (geo) {
      if (!geo) return;
      var feature = geo.features.filter(function (f) {
        return f.properties && f.properties.state_name === current.state && f.properties.district_name === districtName;
      })[0];
      removeLayer('district');
      mapLayers.district = drawCasedFeature('district', feature, function () { selectDistrict(districtName, true); });
      placeMarker(feature);
      fadeParents('district');
      fitToFeature(feature);
      if (window.VindhyaForecast && window.currentLocationPoint) {
        window.VindhyaForecast.load(window.currentLocationPoint.lat, window.currentLocationPoint.lon, districtName);
      }
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
    restoreDistrictMetricsIfReal();
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
      placeMarker(feature);
      fadeParents('block');
      fitToFeature(feature);
      if (window.VindhyaForecast && window.currentLocationPoint) {
        window.VindhyaForecast.load(window.currentLocationPoint.lat, window.currentLocationPoint.lon, blockName + ', ' + current.district);
      }
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
    if (!vilLgd) { removeLayer('village'); restoreDistrictMetricsIfReal(); updateBreadcrumb(); return; }

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
      placeMarker(feature);
      // Same popup content (incl. src_agency) on the marker as on the
      // polygon -- clicking a 30px pin is reliable, clicking a 2px
      // boundary stroke often isn't.
      if (marker) marker.bindPopup(popupHtml(name, feature.properties));
      mapLayers.village.eachLayer(function (sub) {
        sub.bindPopup ? sub.bindPopup(popupHtml(name, feature.properties)) :
          (sub.eachLayer && sub.eachLayer(function (l) { if (l.bindPopup) l.bindPopup(popupHtml(name, feature.properties)); }));
      });
      fadeParents('village');
      fitToFeature(feature);
      current.village = name;
      if (window.VindhyaForecast && window.currentLocationPoint) {
        window.VindhyaForecast.load(window.currentLocationPoint.lat, window.currentLocationPoint.lon, name);
      }
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
      // Village profile (population, water sources, land use, irrigation,
      // nearest town) -- unlike the IMD climate panel above, this is real
      // for every state, not just the 5 MP_DISTRICTS with computed indices.
      renderVillageProfile(stateSlug, slugify(current.district), vilLgd, name);
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
    // adv-title-0/adv-body-0 idle-state text removed 2026-08-14 alongside
    // the right-panel Farmer Advisory block itself (owner instruction).

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

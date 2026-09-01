/*
 * soil_moisture_loader.js -- MERA_KHET_PROMPT.md B1: real SMAP soil
 * moisture at all four tiers (village / block / district / state),
 * from dashboard/data/soil_moisture/<state_slug>/<district_slug>.json
 * (scripts/13_gee_national_soil_moisture.py, real NASA SMAP L4 via GEE).
 *
 * Answers the farmer's most common question directly: "abhi paani dun ya
 * rukun" (should I irrigate now, or wait).
 *
 * HONESTY RULES this file exists specifically to get right (owner's spec,
 * MERA_KHET_PROMPT.md B1 + the "NIYAM -- dono bhaag par" section):
 *   - Resolution is ~9 km -- stated on every tier, every time, never
 *     dropped even when the number looks village-specific.
 *   - Village tier NEVER claims a village-specific value -- it is always
 *     the SAME value as every other village sharing that SMAP cell, and
 *     the real count of villages sharing it is always shown (N, counted
 *     by the pipeline script, never a placeholder).
 *   - Every aggregate (block/district/state) shows mean + standard
 *     deviation + how many real units it was built from. Never a bare
 *     mean.
 *   - A district/state with no real coverage yet says so plainly --
 *     never substitutes a neighbouring unit's number.
 *   - The one-line irrigation hint below the numbers is a fixed,
 *     code-defined threshold band (not a model's guess, not fabricated
 *     for this place) -- explicitly labelled as a generic reference band
 *     that varies by soil texture, never presented as a specific
 *     recommendation for the farmer's exact field.
 *
 * Pattern: addPane() (own tab, like live_weather_loader.js) + direct
 * DOM-selection reads (stateSelect/districtSelect/blockSelect/
 * villageSelect .value -- national_selector.js keeps these authoritative
 * and in sync with the map both directions, so reading them directly here
 * is simpler and just as reliable as threading a private selection object
 * through window).
 */
(function () {
  'use strict';

  var manifestPromise = null;
  var manifestSet = null;       // "stateSlug/districtSlug" -> true
  var districtsIndexPromise = null;
  var stateDistrictTotals = null; // stateName -> total district count (districts_index.json)
  var cache = {};                 // "stateSlug/districtSlug" -> parsed file

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

  function fmt(v, d) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d == null ? 3 : d);
  }

  function el(id) { return document.getElementById(id); }

  function currentSelection() {
    var st = el('stateSelect'), ds = el('districtSelect'), bs = el('blockSelect'), vs = el('villageSelect');
    return {
      stateName: st ? st.value : '',
      districtName: ds ? ds.value : '',
      blockName: bs ? bs.value : '',
      vilLgd: vs ? vs.value : ''
    };
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  function loadManifest() {
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetchWithTimeout('data/soil_moisture/manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        manifestSet = {};
        if (m && Array.isArray(m.districts)) m.districts.forEach(function (d) { manifestSet[d] = true; });
        return manifestSet;
      })
      .catch(function () { manifestSet = {}; return manifestSet; });
    return manifestPromise;
  }

  function loadDistrictsIndex() {
    if (districtsIndexPromise) return districtsIndexPromise;
    // Concatenated (not one closed literal) to match the existing
    // 'data/boundaries/' prefix patch in app.py -- see its own comment
    // for why the prefix must stay its own literal for the Streamlit
    // deployment's string-patching to find it.
    districtsIndexPromise = fetchWithTimeout('data/boundaries/' + 'soi/districts_index.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) {
        stateDistrictTotals = {};
        if (idx && Array.isArray(idx.districts)) {
          idx.districts.forEach(function (d) {
            stateDistrictTotals[d.state_name] = (stateDistrictTotals[d.state_name] || 0) + 1;
          });
        }
        return stateDistrictTotals;
      })
      .catch(function () { stateDistrictTotals = {}; return stateDistrictTotals; });
    return districtsIndexPromise;
  }

  function loadDistrictFile(stateSlug, dslug) {
    var key = stateSlug + '/' + dslug;
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetchWithTimeout('data/soil_moisture/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) { if (file) cache[key] = file; return file; })
      .catch(function () { return null; });
  }

  // ---------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------
  function irrigationHint(sm) {
    // Fixed, code-defined reference band -- NOT a model output, NOT
    // fabricated per-place advice. Generic volumetric-soil-moisture
    // convention (approx. wilting point / field-capacity midrange for
    // many agricultural soils); real texture (sandy/loam/clay) shifts
    // these thresholds, which is why the caveat below is always shown
    // alongside it, never the hint alone.
    if (sm == null) return null;
    if (sm < 0.15) return { cls: 'red', text: 'मिट्टी सूखी · सिंचाई पर विचार करें / Soil dry · consider irrigating' };
    if (sm < 0.30) return { cls: 'orange', text: 'मध्यम नमी · फसल-अवस्था अनुसार तय करें / Moderate moisture · weigh crop stage' };
    return { cls: 'green', text: 'नमी पर्याप्त · तुरंत सिंचाई अनावश्यक / Moisture adequate · irrigation not urgent' };
  }

  // i-icon tooltip helper -- long explanation goes in the title attribute,
  // never inline as panel text (owner spec, item 2).
  function infoIcon(title) {
    return '<i class="fa fa-circle-info" title="' + String(title).replace(/"/g, '&quot;') + '" '
      + 'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i>';
  }

  function statCard(label, value, color) {
    return '<div class="metric-card"><div class="metric-label">' + label + '</div>'
      + '<div class="metric-value" style="color:' + (color || 'var(--text)') + '">' + value + '</div></div>';
  }

  // Terse label line (item 2) -- full method note lives in the i-icon tooltip.
  var RESOLUTION_LABEL = 'SMAP L4 · ~9 किमी ग्रिड · गांव-स्तर साझा मान / SMAP L4 · ~9 km grid · village tier shared';
  var RESOLUTION_TOOLTIP = 'NASA SMAP L4, EASE-Grid 2.0. One grid cell covers many villages -- the village-tier '
    + 'value is the shared cell value, not village-specific. / एक ग्रिड सेल कई गांवों को कवर करता है, गांव-विशिष्ट मान नहीं है।';
  var RESOLUTION_NOTE = RESOLUTION_LABEL + ' ' + infoIcon(RESOLUTION_TOOLTIP);

  function villageFramingText(cellVal, nVillages, unit) {
    // Owner's exact target format (item 2): "स्रोत: SMAP, 9 किमी ग्रिड ·
    // 48 गाँव साझा · खेत-स्तर नहीं" -- a label, not a sentence. The fuller
    // explanation moves into the i-icon tooltip.
    var tooltip = 'यह आपके गांव वाली 9 किमी ग्रिड सेल का मान है। इस सेल में लगभग ' + nVillages
      + ' गांव हैं, सबका मान यही होगा। यह आपके खेत का अपना माप नहीं है। / This is the shared 9 km '
      + 'grid-cell value for your village. About ' + nVillages + ' villages share this cell and show '
      + 'the same value. Not a measurement of your own field.';
    return '<div style="padding:0.4rem 0.7rem;background:rgba(255,204,0,0.07);border:1px solid rgba(255,204,0,0.3);'
      + 'border-radius:var(--radius-6);font-size:var(--fs-1);line-height:1.5;color:var(--text);margin-top:0.4rem;">'
      + 'स्रोत: SMAP, 9 किमी ग्रिड · ' + nVillages + ' गाँव साझा · खेत-स्तर नहीं '
      + '<br>Source: SMAP, 9 km grid · ' + nVillages + ' villages shared · not field-level '
      + infoIcon(tooltip)
      + '</div>';
  }

  function renderDistrictTier(file, districtName) {
    var d = file.district || {};
    var rollup = file.district_block_rollup;
    var h = '<div class="section-header"><i class="fa fa-tint" style="color:var(--cyan)"></i>'
      + '<div class="section-title">SOIL MOISTURE — ' + districtName + ' (DISTRICT)</div></div>';
    h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.6rem 0.75rem;">'
      + statCard('SURFACE SM MEAN (m3/m3)', fmt(d.sm_surface_mean), 'var(--cyan)')
      + statCard('STD DEV', fmt(d.sm_surface_stddev), 'var(--orange)')
      + statCard('N (SMAP CELLS)', d.n_cells != null ? d.n_cells : '—', 'var(--green,#6fc795)')
      + statCard('ROOT ZONE MEAN', fmt(d.sm_rootzone_mean), 'var(--blue)')
      + '</div>';
    if (rollup) {
      h += '<div style="padding:0 0.75rem 0.5rem;font-size:var(--fs-1);color:var(--text-dim);">'
        + 'Cross-check (rollup) · mean ' + fmt(rollup.sm_surface_mean) + ' · SD '
        + fmt(rollup.sm_surface_stddev) + ' · N=' + rollup.n_blocks + ' blocks</div>';
    }
    var hint = irrigationHint(d.sm_surface_mean);
    if (hint) {
      h += '<div style="padding:0 0.75rem 0.5rem;"><div class="metric-card" style="border-left:3px solid var(--' + hint.cls + ',' + hint.cls + ')">'
        + '<div style="font-size:var(--fs-2);line-height:1.5;">' + hint.text + '</div>'
        + '<div style="font-size:var(--fs-1);color:var(--text-dim);margin-top:0.3rem;">सामान्य संदर्भ बैंड · मिट्टी अनुसार बदलता है '
        + infoIcon('Fixed reference band, not a model-generated recommendation. Real soil texture (sandy/loam/clay) shifts these thresholds.')
        + '</div></div></div>';
    }
    h += '<div style="padding:0 0.75rem 0.5rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">' + RESOLUTION_NOTE + '</div>';
    return h;
  }

  function renderBlockTier(file, selectedBlockName) {
    var blocks = file.blocks || [];
    if (!blocks.length) {
      return '<div style="padding:0.4rem 0.75rem;color:var(--text-dim);font-size:var(--fs-1);">'
        + 'Not available · ' + infoIcon('No village boundary file for this district yet.') + '</div>';
    }
    var h = '<div class="section-header" style="margin-top:0.4rem;"><div class="section-title">BLOCK / TEHSIL BREAKDOWN</div></div>';
    h += '<div style="max-height:180px;overflow:auto;padding:0 0.75rem;">';
    h += '<table style="width:100%;font-size:0.65rem;border-collapse:collapse;">'
      + '<thead><tr style="text-align:left;color:var(--text-dim)"><th>Block</th><th>Mean</th><th>SD</th><th>N villages</th><th>Cells</th></tr></thead><tbody>';
    blocks.forEach(function (b) {
      var isSel = selectedBlockName && b.block_name && selectedBlockName.trim().toLowerCase() === String(b.block_name).trim().toLowerCase();
      h += '<tr style="border-top:1px solid var(--border);' + (isSel ? 'background:rgba(26,138,158,0.12);font-weight:700;' : '') + '">'
        + '<td style="padding:2px 0;">' + (b.block_name || '—') + (isSel ? ' <i class="fa fa-check" style="color:var(--cyan)"></i>' : '') + '</td>'
        + '<td>' + fmt(b.sm_surface_mean) + '</td><td>' + fmt(b.sm_surface_stddev) + '</td>'
        + '<td>' + (b.n_villages != null ? b.n_villages : '—') + '</td><td>' + (b.n_cells_spanned != null ? b.n_cells_spanned : '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function renderVillageTier(file, vilLgd) {
    if (!vilLgd) return '';
    var v = (file.villages || {})[String(vilLgd)];
    if (!v) {
      return '<div style="padding:0.4rem 0.75rem;color:var(--text-dim);font-size:var(--fs-1);">'
        + 'Not available · ' + infoIcon('This village is not in the soil-moisture village breakdown for this district yet.') + '</div>';
    }
    var villageName = v[0], sdcode = v[1], cellIdx = v[2];
    var cell = (file.district && file.district.cells || [])[cellIdx];
    if (!cell) return '';
    var h = '<div class="section-header" style="margin-top:0.4rem;"><div class="section-title">VILLAGE — ' + (villageName || '') + '</div></div>';
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;padding:0.5rem 0.75rem;">'
      + statCard('SURFACE SM (m3/m3)', fmt(cell.sm_surface), 'var(--cyan)')
      + statCard('ROOT ZONE SM', fmt(cell.sm_rootzone), 'var(--blue)')
      + statCard('N VILLAGES SHARING CELL', cell.n_villages_sharing_cell != null ? cell.n_villages_sharing_cell : '—', 'var(--green,#6fc795)')
      + '</div>';
    h += '<div style="padding:0 0.75rem;">' + villageFramingText(cell.sm_surface, cell.n_villages_sharing_cell != null ? cell.n_villages_sharing_cell : '?') + '</div>';
    var hint = irrigationHint(cell.sm_surface);
    if (hint) {
      h += '<div style="padding:0.5rem 0.75rem 0;"><div class="metric-card" style="border-left:3px solid var(--' + hint.cls + ',' + hint.cls + ')">'
        + '<div style="font-size:0.7rem;line-height:1.5;">' + hint.text + '</div></div></div>';
    }
    return h;
  }

  // Picks the most specific REAL value this district file actually has for
  // the current selection -- per-village SMAP cell (renderVillageTier's own
  // lookup, real) if a village is picked and present in the breakdown, else
  // the per-block mean (renderBlockTier's own rollup, real) if a block is
  // picked and present, else the plain district mean. Never fabricates a
  // number for a level that has no real row of its own -- falls back one
  // level up and says so, same convention as national_selector.js's
  // climateLevelSuffix().
  function resolveMostSpecificSm(file, sel, districtName) {
    if (sel.vilLgd) {
      var v = (file.villages || {})[String(sel.vilLgd)];
      var cell = v ? (file.district && file.district.cells || [])[v[2]] : null;
      if (cell && cell.sm_surface != null) {
        return { value: cell.sm_surface, label: (v[0] || 'Village') + ' · village-tier (SMAP cell shared by ' + (cell.n_villages_sharing_cell != null ? cell.n_villages_sharing_cell : '?') + ' villages)' };
      }
    }
    if (sel.blockName) {
      var blocks = file.blocks || [];
      var match = null;
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].block_name && String(blocks[i].block_name).trim().toLowerCase() === String(sel.blockName).trim().toLowerCase()) { match = blocks[i]; break; }
      }
      if (match && match.sm_surface_mean != null) {
        return { value: match.sm_surface_mean, label: sel.blockName + ' block mean (N=' + (match.n_cells_spanned != null ? match.n_cells_spanned : '?') + ' cells)' };
      }
      // No real per-block row for this block -- fall back to the district
      // mean, but say so, rather than silently showing it unlabeled.
      return { value: file.district && file.district.sm_surface_mean, label: (districtName || '') + ' district mean · district-level estimate (no block-specific data)' };
    }
    return { value: file.district && file.district.sm_surface_mean, label: (districtName || '') + ' district mean (~9 km cells)' };
  }

  function renderStateTier(stateName, files, nComputed, nTotal) {
    var vals = files.map(function (f) { return f.district && f.district.sm_surface_mean; }).filter(function (v) { return v != null; });
    var h = '<div class="section-header"><i class="fa fa-tint" style="color:var(--cyan)"></i>'
      + '<div class="section-title">SOIL MOISTURE — ' + stateName + ' (STATE)</div></div>';
    if (!vals.length) {
      h += '<div style="padding:0.5rem 0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
        + 'Not yet computed · ' + stateName + '</div>';
      return h;
    }
    var n = vals.length;
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / n;
    var variance = vals.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / n;
    var sd = Math.sqrt(variance);
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;padding:0.6rem 0.75rem;">'
      + statCard('MEAN OF DISTRICT MEANS', mean.toFixed(3), 'var(--cyan)')
      + statCard('STD DEV (across districts)', sd.toFixed(3), 'var(--orange)')
      + statCard('N DISTRICTS COMPUTED', n + (nTotal ? ' of ' + nTotal : ''), 'var(--green,#6fc795)')
      + '</div>';
    h += '<div style="padding:0 0.75rem 0.5rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">'
      + 'Partial coverage · ' + n + (nTotal ? (' of ' + nTotal + ' districts') : ' districts computed') + ' '
      + infoIcon('Mean of the districts already computed for ' + stateName + '; full-state coverage not yet available.')
      + ' ' + RESOLUTION_NOTE + '</div>';
    return h;
  }

  // ---------------------------------------------------------------------
  // Main render orchestration
  // ---------------------------------------------------------------------
  function showEmpty(msg) {
    var host = el('soilmoisture-panel-body');
    if (!host) return;
    host.className = 'btm-pane-empty';
    host.innerHTML = '<i class="fa fa-tint-slash chart-empty-icon"></i><span>' + msg + '</span>'
      + '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> Select district</button>';
  }

  // trendLabel: owner report (2026-09, Hinglish) -- the right-panel Soil
  // Moisture card previously ALWAYS showed the district mean, unchanged,
  // regardless of whether a block or village was selected underneath it,
  // with a generic "~9 km cell value" caption that never said which tier
  // the number actually belonged to (the exact silent parent-substitution
  // STANDING ORDERS #6 forbids). render() below now resolves the most
  // specific REAL value available (per-village SMAP cell -> per-block mean
  // -> district mean -> state mean) and passes an honest label for
  // whichever one it actually found.
  function updateMainMetricCard(sm, meta, trendLabel) {
    var val = el('m-soil'), bar = el('bar-soil'), trend = el('soil-trend'), src = el('soil-source');
    if (sm == null) {
      if (val) val.textContent = '—';
      if (bar) bar.style.width = '0%';
      if (trend) trend.textContent = 'Select a district';
      if (src) src.textContent = 'SMAP · not computed yet';
      return;
    }
    if (val) val.textContent = fmt(sm, 3) + ' m3/m3';
    if (bar) bar.style.width = Math.min(100, Math.max(0, Math.round(sm / 0.5 * 100))) + '%';
    if (trend) trend.textContent = trendLabel || '~9 km cell value';
    // Standard closing-line format (item 5): Source · resolution · date.
    var dateStr = (meta && meta.last_updated) ? meta.last_updated : '';
    if (src) src.textContent = 'SMAP L4 · ~9 km' + (dateStr ? ' · ' + dateStr : '');
  }

  function render() {
    var host = el('soilmoisture-panel-body');
    if (!host) return;
    host.className = 'u-scroll-pane'; // reset from the centered .btm-pane-empty card (showEmpty) back to normal block flow for real content
    var sel = currentSelection();
    if (!sel.stateName) {
      showEmpty('राज्य/ज़िला/ब्लॉक/गाँव चुनें · Select a state/district/block/village');
      updateMainMetricCard(null);
      return;
    }
    var stateSlug = slugify(sel.stateName);

    loadManifest().then(function () {
      if (!sel.districtName) {
        // STATE TIER: aggregate whichever districts in this state are computed.
        var keys = Object.keys(manifestSet).filter(function (k) { return k.indexOf(stateSlug + '/') === 0; });
        updateMainMetricCard(null);
        if (!keys.length) {
          host.innerHTML = renderStateTier(sel.stateName, [], 0, null);
          loadDistrictsIndex().then(function (totals) {
            var host2 = el('soilmoisture-panel-body');
            if (host2) host2.innerHTML = renderStateTier(sel.stateName, [], 0, totals[sel.stateName]);
          });
          return;
        }
        Promise.all(keys.map(function (k) {
          var parts = k.split('/');
          return loadDistrictFile(parts[0], parts[1]);
        })).then(function (files) {
          files = files.filter(Boolean);
          loadDistrictsIndex().then(function (totals) {
            var host2 = el('soilmoisture-panel-body');
            if (host2) host2.innerHTML = renderStateTier(sel.stateName, files, files.length, totals[sel.stateName]);
            // Owner report (2026-09): the right-panel Soil Moisture card
            // stayed 'Not available' at state level even though a real
            // state-wide mean was already computed and shown right above in
            // this same pane -- STANDING ORDERS #6 kind of gap (a genuine
            // aggregate existed, just wasn't surfaced everywhere it should
            // be). Guarded on the selection still being this bare state
            // (no district picked meanwhile) so a fast drill-down never gets
            // clobbered by this slower state-wide fetch resolving late.
            var stillSameBareState = currentSelection().stateName === sel.stateName && !currentSelection().districtName;
            if (!stillSameBareState) return;
            var vals = files.map(function (f) { return f.district && f.district.sm_surface_mean; }).filter(function (v) { return v != null; });
            if (vals.length) {
              var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
              var nTotal = totals[sel.stateName];
              updateMainMetricCard(mean, null, sel.stateName + ' state mean · ' + vals.length + (nTotal ? ' of ' + nTotal : '') + ' real districts');
            } else {
              updateMainMetricCard(null);
            }
          });
        });
        return;
      }

      // DISTRICT (+ optionally block/village) TIER
      var dslug = slugify(sel.districtName);
      var key = stateSlug + '/' + dslug;
      if (!manifestSet[key]) {
        host.innerHTML = '<div style="padding:0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
          + 'Not yet computed · ' + sel.districtName + ' · ' + Object.keys(manifestSet).length + ' districts nationally '
          + '<a href="#" onclick="setBtmTab(\'soilmoisture\');return false;">Retry</a></div>';
        updateMainMetricCard(null);
        return;
      }
      loadDistrictFile(stateSlug, dslug).then(function (file) {
        if (!file) { showEmpty('Failed to load · ' + sel.districtName); updateMainMetricCard(null); return; }
        var h = renderDistrictTier(file, sel.districtName);
        h += renderBlockTier(file, sel.blockName);
        h += renderVillageTier(file, sel.vilLgd);
        var host2 = el('soilmoisture-panel-body');
        if (host2) host2.innerHTML = h;
        var resolved = resolveMostSpecificSm(file, sel, sel.districtName);
        updateMainMetricCard(resolved.value, file.metadata, resolved.label);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Pane + tab wiring (matches live_weather_loader.js's addPane pattern --
  // setNav('soil') in index.html already calls setBtmTab('soilmoisture')
  // and window.VindhyaSoilMoisture.reload()).
  // ---------------------------------------------------------------------
  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || el('pane-soilmoisture')) return;

    var p = document.createElement('div');
    p.className = 'btm-pane';
    p.id = 'pane-soilmoisture';
    p.innerHTML = '<div class="section-header"><i class="fa fa-tint u-cyan-sm"></i>'
      + '<div class="section-title">SOIL MOISTURE — SMAP L4 (~9 km)</div></div>'
      + '<div style="padding:0.4rem 0.75rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">'
      + RESOLUTION_NOTE + '</div>'
      + '<div id="soilmoisture-panel-body" class="btm-pane-empty">'
      + '<i class="fa fa-tint-slash chart-empty-icon"></i><span>राज्य/ज़िला/ब्लॉक/गाँव चुनें · Select a state/district/block/village</span>'
      + '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> Select district</button></div>';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !el('soilmoisture-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-tint"></i>Soil Moisture';
      tab.className = 'btm-tab btm-tab-dup'; // owner report 2026-08-14: sidebar already has this exact item, this button was a visible duplicate
      tab.id = 'soilmoisture-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        el('pane-soilmoisture').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        render();
      };
      tabs.appendChild(tab);
    }
  }

  function wireSelectionHooks() {
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      if (typeof originalOnDistrictChange === 'function') originalOnDistrictChange(distKey);
      render();
    };
    var originalOnBlockChange = window.onBlockChange;
    window.onBlockChange = function (blockName) {
      if (typeof originalOnBlockChange === 'function') originalOnBlockChange(blockName);
      render();
    };
    var originalOnVillageChange = window.onVillageChange;
    window.onVillageChange = function (vilLgd) {
      if (typeof originalOnVillageChange === 'function') originalOnVillageChange(vilLgd);
      render();
    };
    var stateSel = el('stateSelect');
    if (stateSel) stateSel.addEventListener('change', function () { setTimeout(render, 300); });
  }

  function boot() {
    if (!document.querySelector('.btm-pane')) { setTimeout(boot, 700); return; }
    try { addPane(); wireSelectionHooks(); } catch (e) { console.warn('[soil_moisture_loader]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }

  window.VindhyaSoilMoisture = { reload: render };
})();

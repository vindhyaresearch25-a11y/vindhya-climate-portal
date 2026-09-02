/*
 * advisory_loader.js -- PENDING.md item 13 ("ADVISORY PARAT"): a derived,
 * rule-based advisory layer combining this portal's own already-published
 * real climate, NDVI and soil-moisture data into plain-language flags,
 * from dashboard/data/advisory/<state_slug>/<district_slug>.json
 * (scripts/15_build_advisory.py).
 *
 * **This is NOT a machine-learning model and NOT a confidence score.**
 * Every flag rendered here is a fixed threshold rule applied to a number
 * this portal already computed elsewhere -- the underlying real number(s)
 * are always shown inline next to the flag, never a bare label. See
 * docs/METHODOLOGY.md Sec 9 for the exact rules.
 *
 * Conventions deliberately copied from the two existing per-district
 * derived-data loaders rather than invented fresh:
 *   - 30s fetch timeout + honest "Not available" fallback, manifest-based
 *     existence lookup: dashboard/national_climate_loader.js.
 *   - Own tab/pane (addPane(), .btm-tab/.btm-pane) rather than reusing the
 *     small, already-spoken-for "Farmer Advisory" card slots (adv-card-0..5
 *     are populated by mp_climate_loader.js/national_climate_loader.js/
 *     national_selector.js/index.html already -- adding a 4th writer to
 *     those same 6 slots would collide): dashboard/soil_moisture_loader.js.
 *
 * Tier scope: DISTRICT ONLY, honestly labelled as such. Block/village tiers
 * have no advisory input of their own (the climate/NDVI pipelines this
 * layer reads are district-level; soil moisture has an SMAP-cell/village
 * tier, but combining it with district-only climate/NDVI into one
 * consistent sub-district advisory is a documented next step, not built
 * here). Selecting a block/village shows the parent DISTRICT's advisory
 * with an explicit note that it is district-wide, never invents a
 * sub-district value. State tier is a real per-flag LOW/MODERATE/HIGH/
 * EXTREME count breakdown across the state's computed districts (a mean is
 * not meaningful for a categorical flag, so this deliberately differs from
 * soil_moisture_loader.js's numeric mean+stddev state tier -- see
 * docs/METHODOLOGY.md Sec 9's "Tier scope" note).
 */
(function () {
  'use strict';

  var manifestPromise = null;
  var manifestSet = null;        // "stateSlug/districtSlug" -> true
  var manifestTotals = null;
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

  // Same isHindi()/t(en,hi) pattern as compare_loader.js/mandi_loader.js/etc
  // -- reads the two signals toggleGlobalLang() in index.html now sets on
  // every toggle (item 3, 2026-08-12).
  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }

  // i-icon tooltip helper -- long explanation goes in the title attribute,
  // never inline as panel text (item 2).
  function infoIcon(title) {
    return '<i class="fa fa-circle-info" title="' + String(title).replace(/"/g, '&quot;') + '" '
      + 'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i>';
  }

  function slugify(s) {
    return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
    manifestPromise = fetchWithTimeout('data/advisory/manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        manifestSet = {};
        manifestTotals = (m && m.totals) || null;
        if (m && Array.isArray(m.districts)) m.districts.forEach(function (d) { manifestSet[d] = true; });
        return manifestSet;
      })
      .catch(function () { manifestSet = {}; manifestTotals = null; return manifestSet; });
    return manifestPromise;
  }

  function loadDistrictsIndex() {
    if (districtsIndexPromise) return districtsIndexPromise;
    // Concatenated (not one closed literal) to match the existing
    // 'data/boundaries/' prefix patch in app.py -- see soil_moisture_loader.js's
    // own identical comment for why.
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
    return fetchWithTimeout('data/advisory/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) { if (file) cache[key] = file; return file; })
      .catch(function () { return null; });
  }

  // ---------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------
  var FLAG_LABELS = {
    heatwave_risk: 'HEATWAVE RISK',
    drought_risk: 'DROUGHT RISK',
    vegetation_stress: 'VEGETATION STRESS (NDVI vs own history)',
    irrigation_need: 'IRRIGATION NEED (soil moisture)'
  };
  var FLAG_ORDER = ['heatwave_risk', 'drought_risk', 'vegetation_stress', 'irrigation_need'];

  function levelColor(level) {
    switch (level) {
      case 'EXTREME': return 'var(--red)';
      case 'HIGH': return 'var(--red)';
      case 'MODERATE': return 'var(--orange)';
      case 'LOW': return 'var(--green,#6fc795)';
      default: return 'var(--text-dim)';
    }
  }

  function flagCard(key, flag) {
    if (!flag) {
      return '<div class="metric-card" style="opacity:0.55;">'
        + '<div class="metric-label">' + FLAG_LABELS[key] + '</div>'
        + '<div style="font-size:var(--fs-1);color:var(--text-dim);margin-top:0.2rem;">' + t('Not available', 'उपलब्ध नहीं') + '</div>'
        + '</div>';
    }
    return '<div class="metric-card" style="border-left:3px solid ' + levelColor(flag.level) + ';">'
      + '<div class="metric-label">' + FLAG_LABELS[key] + '</div>'
      + '<div class="metric-value" style="color:' + levelColor(flag.level) + ';font-size:1rem;">' + flag.level + '</div>'
      + '<div style="font-size:var(--fs-1);line-height:1.5;color:var(--text-dim);margin-top:0.3rem;">' + flag.note + '</div>'
      + '</div>';
  }

  // Terse label (item 2) -- full methodology moves to the i-icon tooltip.
  var RULE_LABEL = function () { return t('Rule-based · not AI/ML', 'नियम-आधारित · AI/ML नहीं'); };
  var RULE_TOOLTIP = 'Every flag is a fixed threshold applied to a real number already computed by this '
    + 'portal\'s own climate/NDVI/soil-moisture pipelines. No confidence score, no model prediction -- see '
    + 'docs/METHODOLOGY.md Sec 9. / हर फ्लैग एक निश्चित सीमा-नियम है, वास्तविक संख्या पर लागू -- कोई AI अनुमान नहीं।';

  function renderDistrictTier(file, districtName, contextNote) {
    var flags = file.flags || {};
    var present = (file.metadata && file.metadata.flags_present) || FLAG_ORDER.filter(function (k) { return !!flags[k]; });
    var h = '<div class="section-header"><i class="fa fa-comment-dots" style="color:var(--cyan)"></i>'
      + '<div class="section-title">ADVISORY — ' + districtName + ' (DISTRICT)</div></div>';
    if (contextNote) {
      h += '<div style="padding:0.4rem 0.75rem 0;font-size:var(--fs-1);color:var(--text-dim);">' + contextNote + '</div>';
    }
    h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;padding:0.6rem 0.75rem;">';
    FLAG_ORDER.forEach(function (key) { h += flagCard(key, flags[key]); });
    h += '</div>';
    h += '<div style="padding:0 0.75rem 0.6rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">'
      + RULE_LABEL() + ' ' + infoIcon(RULE_TOOLTIP) + ' · ' + t('flags', 'फ्लैग') + ': '
      + (present.length ? present.join(', ') : t('none', 'कोई नहीं')) + '</div>';
    return h;
  }

  function renderStateTier(stateName, files, nComputed, nTotal) {
    var h = '<div class="section-header"><i class="fa fa-comment-dots" style="color:var(--cyan)"></i>'
      + '<div class="section-title">ADVISORY — ' + stateName + ' (STATE)</div></div>';
    if (!files.length) {
      h += '<div style="padding:0.5rem 0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
        + t('Not yet computed', 'अभी गणना नहीं हुई') + ' · ' + stateName + '</div>';
      return h;
    }
    // Categorical flags can't be averaged honestly -- a real per-level COUNT
    // across the state's computed districts is the correct aggregation form.
    // The existing "mean + stddev + N, never bare" convention (FINAL_PROMPT.md
    // Phase 8.2, already used by soil_moisture_loader.js and the NDVI
    // pipeline's period_summary) only applies to continuous numbers; this is
    // its categorical equivalent -- a full distribution, never collapsed
    // into one fabricated "state score".
    h += '<div style="padding:0 0.75rem 0.3rem;font-size:var(--fs-1);color:var(--text-dim);">'
      + 'N = ' + files.length + ' ' + t('of', 'में से') + ' ' + (nTotal || '?') + ' ' + t('districts', 'ज़िले') + ' '
      + infoIcon('Counts are real per-district flag levels, not an average -- a categorical flag has no meaningful mean.')
      + '</div>';
    h += '<div style="padding:0 0.75rem 0.6rem;">';
    FLAG_ORDER.forEach(function (key) {
      var counts = { LOW: 0, MODERATE: 0, HIGH: 0, EXTREME: 0 };
      var n = 0;
      files.forEach(function (f) {
        var flag = (f.flags || {})[key];
        if (flag && counts.hasOwnProperty(flag.level)) { counts[flag.level]++; n++; }
      });
      h += '<div style="margin-bottom:0.4rem;">'
        + '<div style="font-size:0.65rem;font-weight:700;color:var(--text-dim);letter-spacing:0.3px;">' + FLAG_LABELS[key] + ' (n=' + n + ')</div>'
        + '<div style="display:flex;gap:0.6rem;font-size:0.68rem;margin-top:0.15rem;">'
        + '<span style="color:' + levelColor('LOW') + '">LOW ' + counts.LOW + '</span>'
        + '<span style="color:' + levelColor('MODERATE') + '">MODERATE ' + counts.MODERATE + '</span>'
        + '<span style="color:' + levelColor('HIGH') + '">HIGH ' + counts.HIGH + '</span>'
        + '<span style="color:' + levelColor('EXTREME') + '">EXTREME ' + counts.EXTREME + '</span>'
        + '</div></div>';
    });
    h += '</div>';
    h += '<div style="padding:0 0.75rem 0.6rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">' + RULE_LABEL() + ' ' + infoIcon(RULE_TOOLTIP) + '</div>';
    return h;
  }

  // ---------------------------------------------------------------------
  // Main render orchestration
  // ---------------------------------------------------------------------
  function showEmpty(msg) {
    var host = el('advisory-panel-body');
    if (!host) return;
    host.className = 'btm-pane-empty';
    host.innerHTML = '<i class="fa fa-comment-slash chart-empty-icon"></i><span>' + msg + '</span>'
      + '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> '
      + t('Select district', 'ज़िला चुनें') + '</button>';
  }

  function render() {
    var host = el('advisory-panel-body');
    if (!host) return;
    host.className = 'u-scroll-pane'; // reset from the centered .btm-pane-empty card (showEmpty) back to normal block flow -- real content below is a scrolling list, not a centered card
    var sel = currentSelection();
    if (!sel.stateName) {
      showEmpty(t('Select a state, district, block or village', 'राज्य, ज़िला, ब्लॉक या गाँव चुनें'));
      return;
    }
    var stateSlug = slugify(sel.stateName);

    loadManifest().then(function () {
      if (!sel.districtName) {
        // STATE TIER
        var keys = Object.keys(manifestSet).filter(function (k) { return k.indexOf(stateSlug + '/') === 0; });
        if (!keys.length) {
          loadDistrictsIndex().then(function (totals) {
            var host2 = el('advisory-panel-body');
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
            var host2 = el('advisory-panel-body');
            if (host2) host2.innerHTML = renderStateTier(sel.stateName, files, files.length, totals[sel.stateName]);
          });
        });
        return;
      }

      // DISTRICT (or block/village, both fall back to the parent district) TIER
      var dslug = slugify(sel.districtName);
      var key = stateSlug + '/' + dslug;
      if (!manifestSet[key]) {
        var nComputed = manifestTotals ? manifestTotals.districts_with_advisory : Object.keys(manifestSet).length;
        var nTotal = manifestTotals ? manifestTotals.districts_nationwide : 733;
        host.innerHTML = '<div style="padding:0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
          + t('Not yet available', 'अभी उपलब्ध नहीं') + ' · ' + sel.districtName + ' · ' + nComputed + '/' + nTotal + ' '
          + infoIcon('Climate data, the mandatory minimum input, has not been computed for this district yet.')
          + ' <a href="#" onclick="setBtmTab(\'advisory\');return false;">' + t('Retry', 'पुनः प्रयास') + '</a></div>';
        return;
      }
      loadDistrictFile(stateSlug, dslug).then(function (file) {
        if (!file) {
          window._vindhyaAdvisory = null;
          showEmpty(t('Failed to load', 'लोड नहीं हुआ') + ' · ' + sel.districtName); return;
        }
        // Published so other panels can reuse this district's REAL advisory
        // flags instead of re-deriving their own version of the same idea.
        // Added 2026-09-02: the Agriculture pane's IRRIGATION NEED field used
        // to be guessed from season + a rainfall cut-off; it now reads
        // irrigation_need from here, which is a documented threshold on real
        // SMAP soil moisture (docs/METHODOLOGY.md Sec 9.4).
        window._vindhyaAdvisory = file;
        var contextNote = null;
        if (sel.vilLgd) {
          contextNote = t('District-wide · not village-specific', 'ज़िला-स्तर · गाँव-विशिष्ट नहीं') + ' '
            + infoIcon('Advisory flags are computed at DISTRICT level only. This is ' + sel.districtName + '\'s district-wide advisory; no village-level advisory exists yet.');
        } else if (sel.blockName) {
          contextNote = t('District-wide · not block-specific', 'ज़िला-स्तर · ब्लॉक-विशिष्ट नहीं') + ' '
            + infoIcon('Advisory flags are computed at DISTRICT level only. This is ' + sel.districtName + '\'s district-wide advisory, not specific to ' + sel.blockName + ' block.');
        }
        var host2 = el('advisory-panel-body');
        if (host2) host2.innerHTML = renderDistrictTier(file, sel.districtName, contextNote);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Pane + tab wiring (matches soil_moisture_loader.js's addPane pattern).
  // ---------------------------------------------------------------------
  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || el('pane-advisory')) return;

    var p = document.createElement('div');
    p.className = 'btm-pane';
    p.id = 'pane-advisory';
    p.innerHTML = '<div class="section-header"><i class="fa fa-comment-dots u-cyan-sm"></i>'
      + '<div class="section-title">ADVISORY — ' + t('rule-based', 'नियम-आधारित') + '</div></div>'
      + '<div style="padding:0.4rem 0.75rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">'
      + t('Rule-based · not AI/ML', 'नियम-आधारित · AI/ML नहीं') + ' '
      + infoIcon('Derived, rule-based flags only -- not a machine-learning prediction, no confidence percentage. Each flag cites the exact real number(s) it was computed from.')
      + '</div>'
      + '<div id="advisory-panel-body" class="btm-pane-empty">'
      + '<i class="fa fa-comment-slash chart-empty-icon"></i><span>' + t('Select a state/district/block/village', 'राज्य/ज़िला/ब्लॉक/गाँव चुनें') + '</span>'
      + '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> ' + t('Select district', 'ज़िला चुनें') + '</button></div>';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !el('advisory-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-comment-dots"></i>' + t('Farmer Advisory', 'किसान सलाह');
      // Un-hidden 2026-09-02 (AUDIT_FIX_PROMPT.md item 1, live re-check).
      // This was marked btm-tab-dup on the premise "sidebar already has
      // this exact item". That premise is no longer true and made
      // #pane-advisory completely unreachable: the sidebar has no Farmer
      // Advisory entry at all, and setNav()'s only 'advisory' branch is
      // `section === 'crop' || section === 'advisory'`, which opens
      // pane-AGRICULTURE, not this pane. Verified live -- the pane builds
      // a full real advisory for Jabalpur (heatwave/drought/NDVI-stress
      // flags, each citing its own IMD/MODIS numbers) that nothing on the
      // page could open. Same class of defect as the five unreachable
      // tabs. Renamed "Advisory" -> "Farmer Advisory" so it stays a
      // distinct name rather than re-creating the item 1 collision.
      tab.className = 'btm-tab';
      tab.id = 'advisory-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        el('pane-advisory').classList.add('active');
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
    try { addPane(); wireSelectionHooks(); } catch (e) { console.warn('[advisory_loader]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }

  window.VindhyaAdvisory = { reload: render };
})();

/*
 * crop_stats_loader.js — district-wise, season-wise crop area/production,
 * nationally (CROP_DATA_PROMPT.md CHARAN 2).
 *
 * DES (Directorate of Economics and Statistics, data.desagri.gov.in) is
 * this portal's MUKHYA (primary) crop-statistics source, 2000-01 to
 * 2022-23, all 36 states/UTs, 372,904 records --
 * dashboard/data/crop_stats_des_by_district/<state_slug>/<district_slug>.json
 * (STANDING ORDERS #8.1: per-district files, never one giant blob --
 * built by scripts/build_crop_stats_des_district_files.py from the 23
 * national per-year files).
 *
 * The legacy data.gov.in pull (dashboard/data/crop_stats.json, 5 Madhya
 * Pradesh districts, 1997-2013) is shown only as a small cross-check
 * note where it overlaps DES, per CROP_DATA_PROMPT.md CHARAN 5's rule
 * ("kabhi mila kar mat dikhao" -- never merge the two into one figure).
 * docs/CROP_DATA_COVERAGE.md's CHARAN 5 finding (0.0% difference on the
 * real overlap -- the legacy file appears to be a republish of DES's own
 * numbers) is why this stays a footnote, not a second data column.
 */
(function () {
  'use strict';

  var DES_BASE = 'data/crop_stats_des_by_district/';
  var LEGACY_URL = 'data/crop_stats.json';

  var _desCache = {};       // "state_slug/district_slug" -> parsed file | null (404)
  var _legacyData = null;
  var _legacyLoading = false;

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

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
    return '<i class="fa fa-circle-info" title="' + String(title).replace(/"/g, '&quot;') + '" ' +
      'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i>';
  }

  function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function fmtNum(v) {
    if (v == null || !isFinite(v)) return '--';
    return Math.round(v).toLocaleString('en-IN');
  }

  function currentStateDistrict() {
    var ss = document.getElementById('stateSelect');
    var ds = document.getElementById('districtSelect');
    var state = ss && ss.value ? ss.value : null;
    var district = ds && ds.value ? ds.value : null;
    if (!state || !district) return null;
    return { stateSlug: slugify(state), districtSlug: slugify(district), stateName: state, districtName: district };
  }

  function loadDesForCurrentDistrict() {
    var sd = currentStateDistrict();
    if (!sd) return Promise.resolve({ data: null, notFound: false });
    var key = sd.stateSlug + '/' + sd.districtSlug;
    // Only successful lookups are cached -- a failed fetch (real 404 for
    // a district DES genuinely doesn't have, or a transient network
    // blip) is never memoized as permanent, so re-selecting the same
    // district later in the same session retries instead of being
    // locked into "not available" forever from one bad attempt.
    if (key in _desCache) return Promise.resolve({ data: _desCache[key], notFound: _desCache[key] === null });
    var url = DES_BASE + sd.stateSlug + '/' + sd.districtSlug + '.json';
    return fetchWithTimeout(url)
      .then(function (r) {
        if (r.status === 404) { _desCache[key] = null; return { data: null, notFound: true }; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function (j) { _desCache[key] = j; return { data: j, notFound: false }; });
      })
      // A real network/timeout failure (not a 404) -- distinct from "this
      // district genuinely has no DES data" so render() can offer a
      // retry instead of a flat "not available".
      .catch(function (err) { return { data: null, notFound: false, error: err.message }; });
  }

  function loadLegacy() {
    if (_legacyData || _legacyLoading) return Promise.resolve(_legacyData);
    _legacyLoading = true;
    return fetchWithTimeout(LEGACY_URL)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { _legacyData = j; return j; })
      .catch(function () { return null; })
      .finally(function () { _legacyLoading = false; });
  }

  function legacyCrossCheckNote(desDistrictName, legacyData) {
    if (!legacyData || !legacyData.districts) return '';
    var slug = slugify(desDistrictName);
    var d = legacyData.districts[slug];
    if (!d || !d.count) return '';
    var yrs = d.year_range ? d.year_range[0] + '-' + d.year_range[1] : '1997-2013';
    return '<div style="margin-top:var(--space-04);padding:var(--space-04) var(--space-05);background:rgba(90,106,122,.08);border-radius:var(--radius-4);' +
      'font-size:var(--fs-1);line-height:1.6;opacity:.85">' +
      t('Cross-check · data.gov.in · ' + yrs, 'क्रॉस-चेक · data.gov.in · ' + yrs) + ' ' +
      infoIcon('A separate data.gov.in pull for this district also exists -- see docs/CROP_DATA_COVERAGE.md CHARAN 5 for how it compares to DES.') +
      '</div>';
  }

  function render() {
    var box = document.getElementById('crop-stats-box');
    if (!box) return;
    var sd = currentStateDistrict();
    if (!sd) {
      box.innerHTML = '<div class="btm-pane-empty"><i class="fa fa-wheat-awn u-icon-lg-muted"></i>' +
        '<div><b>' + t('Crop Statistics', 'फसल आंकड़े') + '</b><br>' +
        t('Select a district to see area/production/yield statistics', 'क्षेत्रफल/उत्पादन/उपज आंकड़े देखने के लिए ज़िला चुनें') + '</div>' +
        '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> ' +
        t('Select district', 'ज़िला चुनें') + '</button></div>';
      return;
    }

    box.innerHTML = '<div style="padding:16px;font-size:12px;opacity:.8">' +
      t('Loading crop statistics...', 'फसल आंकड़े लाए जा रहे हैं...') + '</div>';

    Promise.all([loadDesForCurrentDistrict(), loadLegacy()]).then(function (results) {
      // A district/state change may have happened while this was in
      // flight -- re-check before rendering so a slow response for a
      // previously-selected district never overwrites the current one.
      var stillCurrent = currentStateDistrict();
      if (!stillCurrent || stillCurrent.stateSlug !== sd.stateSlug || stillCurrent.districtSlug !== sd.districtSlug) return;

      var desResult = results[0];
      var legacy = results[1];
      var des = desResult.data;

      if (!des || !des.records || !des.records.length) {
        if (desResult.notFound) {
          box.innerHTML = '<div style="padding:12px 14px;font-size:12px;line-height:1.8">' +
            '<b>' + t('Crop Statistics', 'फसल आंकड़े') + '</b><br>' +
            t('Not yet available', 'अभी उपलब्ध नहीं') + ' · ' + sd.districtName +
            '<div style="margin-top:var(--space-03);font-size:var(--fs-1);opacity:.7">' +
            t('Source · DES (data.desagri.gov.in) · 2000-01–2022-23', 'स्रोत · DES (data.desagri.gov.in) · 2000-01–2022-23') + ' ' +
            infoIcon('This district may be newer than the source snapshot, or its name may differ; see docs/DISTRICT_NAME_MAP.md.') +
            '</div></div>';
        } else {
          // A real fetch/network failure, not "this district has no DES
          // data" -- offer a retry instead of implying it's permanently
          // unavailable (Phase 2.8).
          box.innerHTML = '<div style="padding:12px 14px;font-size:12px;line-height:1.8">' +
            '<b style="color:#c0392b">' + t('Crop statistics failed to load', 'फसल आंकड़े लोड नहीं हुए') + '</b><br>' +
            (desResult.error || '') +
            '<br><button id="cropstats-retry-btn" style="margin-top:8px;background:#c0392b;color:#fff;' +
            'border:none;border-radius:4px;padding:4px 14px;font-size:11px;font-weight:700;cursor:pointer;">' +
            t('Retry', 'फिर कोशिश करें') + '</button></div>';
          var btn = document.getElementById('cropstats-retry-btn');
          if (btn) btn.onclick = function () { render(); };
        }
        return;
      }

      var groups = {};
      des.records.forEach(function (r) {
        var key = r.year + '|' + r.season;
        (groups[key] = groups[key] || []).push(r);
      });
      var groupKeys = Object.keys(groups).sort().reverse().slice(0, 6);

      var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">';
      h += '<div style="margin-bottom:9px"><span style="display:inline-block;padding:1px 7px;border-radius:9px;' +
        'background:#2d8f5c;color:#fff;font-size:10px;font-weight:700;letter-spacing:.3px">DES</span> ' +
        '<b>' + t('Crop Statistics', 'फसल आंकड़े') + '</b> &mdash; ' + des.metadata.district +
        ' <span style="opacity:.7">(' + (des.metadata.year_range ? des.metadata.year_range[0].split(' ')[0] + '-' + des.metadata.year_range[1].split(' ')[0] : '') + ')</span></div>';

      groupKeys.forEach(function (key) {
        var parts = key.split('|');
        var rows = groups[key].slice().sort(function (a, b) { return (b.area_ha || 0) - (a.area_ha || 0); }).slice(0, 8);
        h += '<div style="margin-bottom:8px"><div style="font-size:10.5px;font-weight:700;opacity:.8;margin-bottom:3px">' +
          parts[0] + ' &middot; ' + parts[1] + '</div>';
        h += '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
          '<tr style="text-align:left;font-size:9.5px;opacity:.65;letter-spacing:.3px">' +
          '<th style="padding:2px 0">' + t('CROP', 'फसल') + '</th>' +
          '<th style="text-align:right">' + t('AREA (ha)', 'क्षेत्र (हे)') + '</th>' +
          '<th style="text-align:right">' + t('PRODUCTION', 'उत्पादन') + '</th>' +
          '<th style="text-align:right">' + t('YIELD/ha', 'उपज/हे') + '</th></tr>';
        rows.forEach(function (r) {
          h += '<tr style="border-top:1px solid var(--border)">' +
            '<td style="padding:3px 0">' + r.crop + '</td>' +
            '<td style="text-align:right;opacity:.85">' + fmtNum(r.area_ha) + '</td>' +
            '<td style="text-align:right;opacity:.85">' + fmtNum(r.production) + '</td>' +
            '<td style="text-align:right;font-weight:700">' + (r.yield_per_ha != null ? r.yield_per_ha.toFixed(2) : '--') + '</td></tr>';
        });
        h += '</table></div>';
      });

      h += legacyCrossCheckNote(des.metadata.district, legacy);

      h += '<div style="margin-top:6px;padding-top:8px;border-top:1px solid var(--border);' +
        'font-size:10px;opacity:.75;line-height:1.6">' +
        t('Source: ', 'स्रोत: ') + (des.metadata.source || 'DES, data.desagri.gov.in') +
        '. ' + t('Yield as published by DES.', 'उपज DES द्वारा प्रकाशित के अनुसार।') +
        '</div></div>';

      box.innerHTML = h;
    });
  }

  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || document.getElementById('pane-cropstats')) return;

    var p = document.createElement('div');
    p.innerHTML = '<div id="crop-stats-box"></div>';
    p.className = 'btm-pane';
    p.id = 'pane-cropstats';
    host.appendChild(p);
    // AUDIT_FIX_PROMPT.md item 9 (2026-08-14): render() used to only run
    // from the tab's own onclick, so #crop-stats-box was a blank empty
    // div until the owner clicked this specific tab at least once. Calling
    // it here shows the real "select a district" state immediately (no
    // network fetch happens on this branch -- see render()'s !sd check),
    // matching what mandi_loader.js already does via its own eager load().
    render();

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !document.getElementById('cropstats-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-wheat-awn"></i>' + t('Crop Statistics', 'फसल आंकड़े');
      tab.className = 'btm-tab';
      tab.id = 'cropstats-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        document.getElementById('pane-cropstats').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        render();
      };
      tabs.appendChild(tab);
    }

    var ds = document.getElementById('districtSelect');
    if (ds) ds.addEventListener('change', function () {
      var pane = document.getElementById('pane-cropstats');
      if (pane && pane.classList.contains('active')) render();
    });
  }

  function boot() {
    if (!document.querySelector('.btm-pane')) { setTimeout(boot, 700); return; }
    try { addPane(); } catch (e) { console.warn('[crop_stats]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 950); });
  } else {
    setTimeout(boot, 950);
  }

  window.VindhyaCropStats = { reload: function () { _desCache = {}; render(); } };
})();

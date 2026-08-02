/*
 * crop_stats_loader.js — district-wise, season-wise crop area/production
 * (Requirement L, docs/AUDIT_2026-08-01.md).
 *
 * Reads data/crop_stats.json, written by scripts/fetch_crop_stats.py.
 * Unlike mandi prices, this source is a static historical dataset (last
 * updated by its publisher 2021-07-13) -- the coverage note from that file
 * is always shown so nobody mistakes 1997-2013 figures for current data.
 */
(function () {
  'use strict';

  var DATA_URL = 'data/crop_stats.json';
  var _data = null;
  var _loading = false;

  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }

  function el(tag, css, html) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function badge(q) {
    var c = q === 'verified' ? '#2d8f5c' : '#8a8a8a';
    return '<span style="display:inline-block;padding:1px 7px;border-radius:9px;' +
      'background:' + c + ';color:#fff;font-size:10px;font-weight:700;' +
      'letter-spacing:.3px">' + q.toUpperCase() + '</span>';
  }

  function fmtNum(v) {
    if (v == null || !isFinite(v)) return '--';
    return Math.round(v).toLocaleString('en-IN');
  }

  // Same bug as mandi_loader.js (found in the same audit pass): the
  // District dropdown holds the real display name, but
  // fetch_crop_stats.py writes JSON keyed by slug -- multi-word district
  // names silently showed "no data" without this.
  function slugify(name) {
    return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function currentDistrict() {
    var ds = document.getElementById('districtSelect');
    return ds && ds.value ? slugify(ds.value) : null;
  }

  function render() {
    var box = document.getElementById('crop-stats-box');
    if (!box) return;

    if (!_data) {
      box.innerHTML = '<div style="padding:16px;font-size:12px;opacity:.8">' +
        t('Loading crop statistics...', 'फसल आंकड़े लाए जा रहे हैं...') + '</div>';
      return;
    }

    var dk = currentDistrict();
    if (!dk) {
      box.innerHTML = '<div style="padding:16px;font-size:12px;line-height:1.8;opacity:.85">' +
        '<b>' + t('Crop Statistics', 'फसल आंकड़े') + '</b><br>' +
        t('Select a district to see historical crop area, production and yield by season.',
          'ऐतिहासिक फसल क्षेत्रफल, उत्पादन और उपज देखने के लिए ज़िला चुनें।') + '</div>';
      return;
    }

    var d = _data.districts && _data.districts[dk];
    var meta = _data.metadata || {};
    var noteHtml = '<div style="padding:8px 10px;margin-bottom:9px;background:rgba(201,168,67,.12);' +
      'border-left:3px solid #c9a843;border-radius:4px;font-size:10.5px;line-height:1.6;">' +
      (meta.coverage_note || '') + '</div>';

    if (!d || !d.records || !d.records.length) {
      box.innerHTML = '<div style="padding:12px 14px;font-size:12px">' + noteHtml +
        t('No crop statistics for this district.', 'इस ज़िले का फसल आंकड़ा नहीं है।') +
        '</div>';
      return;
    }

    // Group by year+season, keep top crops by area within each group
    var groups = {};
    d.records.forEach(function (r) {
      var key = r.year + '|' + r.season;
      (groups[key] = groups[key] || []).push(r);
    });
    var groupKeys = Object.keys(groups).sort().reverse().slice(0, 6); // most recent 6 year-season groups

    var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">' + noteHtml;
    h += '<div style="margin-bottom:9px">' + badge(meta.data_quality || 'verified') +
      ' <b>' + t('Crop Statistics', 'फसल आंकड़े') + '</b> &mdash; ' + d.name +
      ' <span style="opacity:.7">(' + (d.year_range ? d.year_range[0] + '-' + d.year_range[1] : '') + ')</span></div>';

    groupKeys.forEach(function (key) {
      var parts = key.split('|');
      var rows = groups[key].slice().sort(function (a, b) { return b.area_ha - a.area_ha; }).slice(0, 8);
      h += '<div style="margin-bottom:8px"><div style="font-size:10.5px;font-weight:700;opacity:.8;margin-bottom:3px">' +
        parts[0] + ' &middot; ' + parts[1] + '</div>';
      h += '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
        '<tr style="text-align:left;font-size:9.5px;opacity:.65;letter-spacing:.3px">' +
        '<th style="padding:2px 0">' + t('CROP', 'फसल') + '</th>' +
        '<th style="text-align:right">' + t('AREA (ha)', 'क्षेत्र (हे)') + '</th>' +
        '<th style="text-align:right">' + t('PRODUCTION (t)', 'उत्पादन (टन)') + '</th>' +
        '<th style="text-align:right">' + t('YIELD (t/ha)', 'उपज (टन/हे)') + '</th></tr>';
      rows.forEach(function (r) {
        h += '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:3px 0">' + r.crop + '</td>' +
          '<td style="text-align:right;opacity:.85">' + fmtNum(r.area_ha) + '</td>' +
          '<td style="text-align:right;opacity:.85">' + fmtNum(r.production_tonnes) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + (r.yield_tonnes_per_ha != null ? r.yield_tonnes_per_ha.toFixed(2) : '--') + '</td></tr>';
      });
      h += '</table></div>';
    });

    h += '<div style="margin-top:6px;padding-top:8px;border-top:1px solid var(--border);' +
      'font-size:10px;opacity:.75;line-height:1.6">' +
      t('Source: ', 'स्रोत: ') + (meta.source || 'data.gov.in') +
      '. ' + t('Yield is derived (production/area) by this portal, not published directly by the source.',
        'उपज इस पोर्टल द्वारा गणना की गई है (उत्पादन/क्षेत्र), स्रोत द्वारा सीधे प्रकाशित नहीं।') +
      '</div></div>';

    box.innerHTML = h;
  }

  function load() {
    if (_loading || _data) { render(); return; }
    _loading = true;
    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) { _data = j; render(); })
      .catch(function (err) {
        var box = document.getElementById('crop-stats-box');
        if (box) {
          box.innerHTML = '<div style="padding:16px;font-size:12px;line-height:1.8">' +
            '<b style="color:#c0392b">' +
            t('Crop statistics not yet generated', 'फसल आंकड़े अभी तैयार नहीं') + '</b><br>' +
            t('Run the "Crop statistics refresh" workflow in GitHub Actions once to ' +
              'create data/crop_stats.json. (' + err.message + ')',
              'GitHub Actions में "Crop statistics refresh" workflow एक बार चलाएँ। (' + err.message + ')') + '</div>';
        }
      })
      .finally(function () { _loading = false; });
  }

  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || document.getElementById('pane-cropstats')) return;

    var p = el('div', '', '<div id="crop-stats-box"></div>');
    p.className = 'btm-pane';
    p.id = 'pane-cropstats';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !document.getElementById('cropstats-tab')) {
      var tab = el('div', '', '<i class="fa fa-wheat-awn"></i>' +
        t('Crop Statistics', 'फसल आंकड़े'));
      tab.className = 'btm-tab';
      tab.id = 'cropstats-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        document.getElementById('pane-cropstats').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        load();
      };
      tabs.appendChild(tab);
    }

    var ds = document.getElementById('districtSelect');
    if (ds) ds.addEventListener('change', function () { if (_data) render(); });
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

  window.VindhyaCropStats = { reload: function () { _data = null; load(); } };
})();

/*
 * horticulture_loader.js — fruits/vegetables/spices/plantation crops/
 * flowers/mushroom Area/Production/Yield, nationally (CROP_DATA_PROMPT.md
 * CHARAN 6 "horticulture alag rakho").
 *
 * Deliberately a SEPARATE panel/tab from crop_stats_loader.js's "Crop
 * Statistics" (field crops, DES). CHARAN 6's own rule: "Dono ko jodkar
 * 'total crop area' mat banao -- galat hoga" -- horticulture and field-
 * crop land-use accounting overlap in ways that don't simply add, so this
 * file never reads crop_stats_loader.js's data and never computes any
 * combined total. See docs/CROP_DATA_COVERAGE.md's Horticulture section
 * for the full resolvability writeup.
 *
 * Source: "Horticultural Statistics at a Glance 2023", Horticulture
 * Statistics Unit, Dept. of Agriculture & Farmers Welfare -- a national
 * PDF compendium (agriwelfare.gov.in), used here as MUKHYA instead of
 * CROP_DATA_PROMPT.md's literal "State Horticulture Department, <saal>"
 * per-state hunt, the same kind of considered national-over-36-state-PDFs
 * choice CHARAN 1/2 already made for DES vs. field-crop state reports.
 *
 * STATE-level only -- no district-wise horticulture dataset exists
 * anywhere (checked; see docs/CROP_DATA_COVERAGE.md). One file per state:
 * dashboard/data/horticulture_stats/<state_slug>.json (28 of 36 states/
 * UTs have real, individually-published figures; the other 8 are folded
 * into the source's own "OTHERS" aggregate and are never guessed at --
 * see NEVER_INDIVIDUALLY_REPORTED below). Every number shown is labelled
 * as a state figure, never implied to be specific to the selected
 * district.
 */
(function () {
  'use strict';

  var HORT_BASE = 'data/horticulture_stats/';

  var _hortCache = {};   // state_slug -> parsed file | null (404)

  // Matches scripts/fetch_horticulture_stats.py's NEVER_INDIVIDUALLY_REPORTED
  // -- a real finding (these 8 states/UTs never appear as a named row in
  // any of the source's 53 crop tables, always folded into "OTHERS"), used
  // to give an honest, specific reason instead of a generic "not found".
  var NEVER_INDIVIDUALLY_REPORTED_SLUGS = {
    goa: 1, chandigarh: 1, delhi: 1, puducherry: 1,
    andaman_and_nicobar_islands: 1, andaman_nicobar_islands: 1,
    dadra_and_nagar_haveli: 1, daman_and_diu: 1,
    the_dadra_nagar_haveli_and_daman_and_diu: 1,
    ladakh: 1, lakshadweep: 1
  };

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

  function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function fmtNum(v) {
    if (v == null || !isFinite(v)) return '--';
    return Math.round(v).toLocaleString('en-IN');
  }

  // Same district-selection gate as crop_stats_loader.js (this bottom-pane
  // cluster is reached only once a district is already selected) -- but
  // the actual fetch below is keyed on state only, since this source is
  // state-level.
  function currentStateDistrict() {
    var ss = document.getElementById('stateSelect');
    var ds = document.getElementById('districtSelect');
    var state = ss && ss.value ? ss.value : null;
    var district = ds && ds.value ? ds.value : null;
    if (!state || !district) return null;
    return { stateSlug: slugify(state), districtSlug: slugify(district), stateName: state, districtName: district };
  }

  function loadHortForCurrentState() {
    var sd = currentStateDistrict();
    if (!sd) return Promise.resolve({ data: null, notFound: false });
    var key = sd.stateSlug;
    // Only successful lookups are cached -- a failed fetch (real 404 for a
    // state this source genuinely doesn't break out, or a transient
    // network blip) is never memoized as permanent, so re-selecting the
    // same state later in the same session retries instead of being
    // locked into "not available" forever from one bad attempt.
    if (key in _hortCache) return Promise.resolve({ data: _hortCache[key], notFound: _hortCache[key] === null });
    var url = HORT_BASE + sd.stateSlug + '.json';
    return fetchWithTimeout(url)
      .then(function (r) {
        if (r.status === 404) { _hortCache[key] = null; return { data: null, notFound: true }; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function (j) { _hortCache[key] = j; return { data: j, notFound: false }; });
      })
      // A real network/timeout failure (not a 404) -- distinct from "this
      // state genuinely has no horticulture data" so render() can offer a
      // retry instead of a flat "not available".
      .catch(function (err) { return { data: null, notFound: false, error: err.message }; });
  }

  function render() {
    var box = document.getElementById('horticulture-box');
    if (!box) return;
    var sd = currentStateDistrict();
    if (!sd) {
      box.innerHTML = '<div style="padding:16px;font-size:12px;line-height:1.8;opacity:.85">' +
        '<b>' + t('Horticulture', 'बागवानी') + '</b><br>' +
        t('Select a district to see horticulture (fruits, vegetables, spices, plantation crops, flowers) area, production and yield for its state.',
          'बागवानी (फल, सब्ज़ी, मसाले, बागानी फसलें, फूल) क्षेत्रफल, उत्पादन और उपज देखने के लिए ज़िला चुनें।') + '</div>';
      return;
    }

    box.innerHTML = '<div style="padding:16px;font-size:12px;opacity:.8">' +
      t('Loading horticulture statistics...', 'बागवानी आंकड़े लाए जा रहे हैं...') + '</div>';

    loadHortForCurrentState().then(function (hortResult) {
      // A district/state change may have happened while this was in
      // flight -- re-check before rendering so a slow response for a
      // previously-selected state never overwrites the current one.
      var stillCurrent = currentStateDistrict();
      if (!stillCurrent || stillCurrent.stateSlug !== sd.stateSlug) return;

      var hort = hortResult.data;

      if (!hort || !hort.records || !hort.records.length) {
        if (hortResult.notFound) {
          var reason;
          if (NEVER_INDIVIDUALLY_REPORTED_SLUGS[sd.stateSlug]) {
            reason = t(
              'The source (Horticultural Statistics at a Glance) does not break ' + sd.stateName +
              ' out individually in its state-wise tables -- smaller producers are published only as a ' +
              'combined "Others" total across every crop table, which cannot be attributed to a specific ' +
              'state without guessing.',
              'स्रोत (Horticultural Statistics at a Glance) ' + sd.stateName + ' को अपनी राज्यवार तालिकाओं में ' +
              'अलग से नहीं दिखाता -- छोटे उत्पादक राज्य हर फसल तालिका में सिर्फ़ एक संयुक्त "अन्य" योग के रूप में ' +
              'प्रकाशित होते हैं, जिसे किसी एक राज्य से जोड़ना अंदाज़ा लगाना होगा।'
            );
          } else {
            reason = t(
              'This state may not be in the source snapshot, or its name may differ from the source\'s own label.',
              'यह राज्य स्रोत में शामिल नहीं हो सकता, या इसका नाम स्रोत के अपने लेबल से अलग हो सकता है।'
            );
          }
          box.innerHTML = '<div style="padding:12px 14px;font-size:12px;line-height:1.8">' +
            '<b>' + t('Horticulture', 'बागवानी') + '</b><br>' +
            t('Data not available for horticulture in ' + sd.stateName + '.', sd.stateName + ' के लिए बागवानी आंकड़े उपलब्ध नहीं हैं।') +
            '<div style="margin-top:6px;font-size:10.5px;opacity:.7">' + reason + '</div></div>';
        } else {
          // A real fetch/network failure, not "this state has no
          // horticulture data" -- offer a retry instead of implying it's
          // permanently unavailable (same Phase 2.8 convention as
          // crop_stats_loader.js).
          box.innerHTML = '<div style="padding:12px 14px;font-size:12px;line-height:1.8">' +
            '<b style="color:#c0392b">' + t('Horticulture statistics failed to load', 'बागवानी आंकड़े लोड नहीं हुए') + '</b><br>' +
            (hortResult.error || '') +
            '<br><button id="horticulture-retry-btn" style="margin-top:8px;background:#c0392b;color:#fff;' +
            'border:none;border-radius:4px;padding:4px 14px;font-size:11px;font-weight:700;cursor:pointer;">' +
            t('Retry', 'फिर कोशिश करें') + '</button></div>';
          var btn = document.getElementById('horticulture-retry-btn');
          if (btn) btn.onclick = function () { render(); };
        }
        return;
      }

      var groups = {};
      hort.records.forEach(function (r) {
        (groups[r.category] = groups[r.category] || []).push(r);
      });
      var categoryOrder = ['Fruits', 'Vegetables', 'Plantation Crops', 'Spices', 'Flowers', 'Mushroom'];
      var categories = Object.keys(groups).sort(function (a, b) {
        return categoryOrder.indexOf(a) - categoryOrder.indexOf(b);
      });
      var latestYear = (hort.metadata.years_covered || []).slice(-1)[0];

      var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">';
      h += '<div style="margin-bottom:6px"><span style="display:inline-block;padding:1px 7px;border-radius:9px;' +
        'background:#c26b1f;color:#fff;font-size:10px;font-weight:700;letter-spacing:.3px">' +
        t('HORTICULTURE', 'बागवानी') + '</span> ' +
        '<b>' + t('Horticulture', 'बागवानी') + '</b> &mdash; ' + hort.metadata.state +
        ' <span style="opacity:.7">(' + (hort.metadata.years_covered || []).join(', ') + ')</span></div>';

      h += '<div style="margin-bottom:9px;padding:6px 8px;background:rgba(194,107,31,.10);border-radius:4px;' +
        'font-size:10px;line-height:1.6">' +
        t('State-level figures (source does not publish district-wise horticulture data) -- apply to all of ' +
          hort.metadata.state + ', not specifically to ' + sd.districtName + '.',
          'राज्य-स्तरीय आंकड़े (स्रोत ज़िलेवार बागवानी आंकड़े प्रकाशित नहीं करता) -- ये सभी ' + hort.metadata.state +
          ' पर लागू हैं, ' + sd.districtName + ' पर विशेष रूप से नहीं।') +
        '</div>';

      categories.forEach(function (cat) {
        var rows = groups[cat]
          .filter(function (r) { return r.year === latestYear; })
          .sort(function (a, b) { return (b.area_ha || 0) - (a.area_ha || 0); })
          .slice(0, 10);
        if (!rows.length) return;
        h += '<div style="margin-bottom:8px"><div style="font-size:10.5px;font-weight:700;opacity:.8;margin-bottom:3px">' +
          cat + ' <span style="opacity:.6;font-weight:400">(' + latestYear + ')</span></div>';
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
        t('Source: ', 'स्रोत: ') + (hort.metadata.source || 'Horticultural Statistics at a Glance') +
        ', ' + (hort.metadata.source_publisher || '') + '. ' +
        t('Not summed with Crop Statistics (field crops, DES) into any total crop area -- the two overlap in land-use accounting.',
          'फसल आंकड़े (डीईएस) के साथ नहीं जोड़ा गया -- दोनों भूमि-उपयोग लेखांकन में अलग-अलग तरीके से गिने जाते हैं।') +
        '</div></div>';

      box.innerHTML = h;
    });
  }

  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || document.getElementById('pane-horticulture')) return;

    var p = document.createElement('div');
    p.innerHTML = '<div id="horticulture-box"></div>';
    p.className = 'btm-pane';
    p.id = 'pane-horticulture';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !document.getElementById('horticulture-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-apple-whole"></i>' + t('Horticulture', 'बागवानी');
      tab.className = 'btm-tab';
      tab.id = 'horticulture-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        document.getElementById('pane-horticulture').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        render();
      };
      tabs.appendChild(tab);
    }

    var ds = document.getElementById('districtSelect');
    if (ds) ds.addEventListener('change', function () {
      var pane = document.getElementById('pane-horticulture');
      if (pane && pane.classList.contains('active')) render();
    });
  }

  function boot() {
    if (!document.querySelector('.btm-pane')) { setTimeout(boot, 700); return; }
    try { addPane(); } catch (e) { console.warn('[horticulture]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }

  window.VindhyaHorticulture = { reload: function () { _hortCache = {}; render(); } };
})();

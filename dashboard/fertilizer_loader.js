/*
 * fertilizer_loader.js -- "Fertilizer & Crop Recommendation" card.
 * AUDIT_FIX_PROMPT.md item 10b, left undone by the previous audit pass
 * ("not implemented... needs an ICAR dose corpus"). Built 2026-09-02.
 *
 * WHERE THE NUMBERS COME FROM -- three real sources, no fourth:
 *
 *  1. THE DOSE  -- data/fertilizer_doses.json, transcribed page-by-page from
 *     "Crop Production Guide - Agriculture 2020" (Directorate of Agriculture,
 *     Chennai + Tamil Nadu Agricultural University). Every row carries the
 *     exact printed page it came from, and every one is that guide's own
 *     "blanket recommendation" -- the value it tells you to use ONLY when no
 *     soil test is available. A crop with no transcribed dose is shown as
 *     "not available for this crop", never filled from a similar crop.
 *
 *  2. THE SEASON -- NOT hardcoded here. Which crops a place actually grows,
 *     and in which season, is read from that district's OWN real DES records
 *     (data/crop_stats_des_by_district/<state>/<district>.json), which carry
 *     a published `season` field per crop-year. So "Kharif crops here" is a
 *     sourced, district-specific fact rather than a national assumption typed
 *     into a JS file. DES "Summer" maps to the Zayad section; "Whole Year"
 *     crops (sugarcane and the like) get their own row rather than being
 *     forced into one of the three seasons.
 *
 *  3. THE AREA   -- the farmer's own measured field from Mera Khet
 *     (window._meraKhetLastField.area_ha). When a field has been measured,
 *     each dose is ALSO shown as kg for that exact area (dose_kg_per_ha x
 *     area_ha). With no measured field, only the per-hectare figure shows --
 *     an assumed field size would be an invented number.
 *
 * Auto-populates: renders on the Location Selector's district change and on
 * Mera Khet's measurement event, with no extra click and no idle
 * "select a village" text once something is already selected.
 *
 * Fetch/timeout/honest-fallback pattern copied from groundwater_loader.js
 * and national_cmip6_loader.js rather than invented fresh; the delayed
 * boot() is the same fix those two needed for national_selector.js's
 * setTimeout(boot, 50) assignment race.
 */
(function () {
  'use strict';

  var HOST_ID = 'fert-rec-panel';
  var doses = null;          // data/fertilizer_doses.json
  var dosesTried = false;
  var desCache = {};
  var lastSel = null;

  function el(id) { return document.getElementById(id); }

  function fetchWithTimeout(url) {
    var c = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = c ? setTimeout(function () { c.abort(); }, 30000) : null;
    return fetch(url, c ? { signal: c.signal } : {})
      .finally(function () { if (t) clearTimeout(t); });
  }

  function slugify(n) {
    return String(n || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function num(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(d === undefined ? 1 : d).replace(/\.0$/, '');
  }

  function isHi() { return window.LANG === 'hi'; }
  function t(en, hi) { return isHi() ? hi : en; }

  function loadDoses() {
    if (doses || dosesTried) return Promise.resolve(doses);
    dosesTried = true;
    return fetchWithTimeout('data/fertilizer_doses.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { doses = j; return j; })
      .catch(function () { doses = null; return null; });
  }

  function loadDes(stateSlug, dslug) {
    var key = stateSlug + '/' + dslug;
    if (desCache[key] !== undefined) return Promise.resolve(desCache[key]);
    return fetchWithTimeout('data/crop_stats_des_by_district/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { desCache[key] = j; return j; })
      .catch(function () { desCache[key] = null; return null; });
  }

  // ---------------------------------------------------------------------
  // Which crops does THIS district actually grow, in which season?
  // Straight from its own DES records. Uses the most recent year in which
  // the district reported any crop at all, so the answer reflects current
  // cropping rather than a 25-year-old pattern; the year used is printed on
  // screen so the reader knows exactly which year they are looking at.
  // ---------------------------------------------------------------------
  var SEASON_KEY = {
    'kharif': 'kharif', 'rabi': 'rabi',
    'summer': 'zayad', 'zaid': 'zayad', 'zayad': 'zayad',
    'whole year': 'whole_year', 'autumn': 'kharif', 'winter': 'rabi'
  };

  function cropsBySeason(desFile) {
    var recs = (desFile && desFile.records) || [];
    if (!recs.length) return null;
    var years = {};
    recs.forEach(function (r) { if (r.year) years[r.year] = true; });
    var latest = Object.keys(years).sort().pop();
    if (!latest) return null;
    var out = { year: latest, kharif: {}, rabi: {}, zayad: {}, whole_year: {} };
    recs.forEach(function (r) {
      if (r.year !== latest) return;
      var sk = SEASON_KEY[String(r.season || '').trim().toLowerCase()];
      if (!sk || !r.crop) return;
      // Keep the real reported area so crops can be ordered by how much of
      // the district actually grows them, biggest first.
      var prev = out[sk][r.crop] || 0;
      out[sk][r.crop] = prev + (Number(r.area_ha) || 0);
    });
    return out;
  }

  function doseFor(cropLabel) {
    if (!doses) return null;
    var key = (doses.aliases || {})[cropLabel];
    if (!key) return null;
    return (doses.crops || {})[key] || null;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function doseRow(entry, areaHa) {
    var perHa = num(entry.N_kg_per_ha) + ' : ' + num(entry.P2O5_kg_per_ha) + ' : ' + num(entry.K2O_kg_per_ha);
    var forField = '';
    if (areaHa && areaHa > 0) {
      forField = '<div class="fert-field">'
        + t('For your measured field (', 'आपके नापे गए खेत के लिए (') + num(areaHa, 2) + ' ha): <b>'
        + num(entry.N_kg_per_ha * areaHa, 1) + ' : '
        + num(entry.P2O5_kg_per_ha * areaHa, 1) + ' : '
        + num(entry.K2O_kg_per_ha * areaHa, 1) + '</b> kg N : P<sub>2</sub>O<sub>5</sub> : K<sub>2</sub>O</div>';
    }
    return '<div class="fert-dose">'
      + '<div class="fert-cond">' + esc(isHi() ? entry.condition_hi : entry.condition_en) + '</div>'
      + '<div class="fert-npk"><b>' + perHa + '</b> kg N : P<sub>2</sub>O<sub>5</sub> : K<sub>2</sub>O / ha</div>'
      + forField
      + '<div class="fert-src">' + t('Source', 'स्रोत') + ' · '
      + esc(entry.source_short) + ', '
      + t('p.', 'पृष्ठ ') + entry.source_page_printed + ' · ' + entry.source_year
      + '</div>'
      + '</div>';
  }

  function seasonBlock(titleEn, titleHi, cropMap, areaHa) {
    var names = Object.keys(cropMap || {});
    if (!names.length) {
      return '<div class="fert-season"><div class="fert-season-h">' + t(titleEn, titleHi) + '</div>'
        + '<div class="fert-none">'
        + t('This district reported no crop in this season for the year shown.',
            'दिखाए गए वर्ष में इस ज़िले ने इस मौसम में कोई फसल दर्ज नहीं की।')
        + '</div></div>';
    }
    // Biggest real reported area first.
    names.sort(function (a, b) { return (cropMap[b] || 0) - (cropMap[a] || 0); });
    var withDose = [], without = [];
    names.forEach(function (n) { (doseFor(n) ? withDose : without).push(n); });

    var h = '<div class="fert-season"><div class="fert-season-h">' + t(titleEn, titleHi) + '</div>';
    if (!withDose.length) {
      h += '<div class="fert-none">'
        + t('No cited fertiliser dose is available for any crop this district grows in this season.',
            'इस मौसम में इस ज़िले की किसी भी फसल के लिए उद्धृत उर्वरक मात्रा उपलब्ध नहीं है।')
        + '</div>';
    }
    withDose.forEach(function (n) {
      var c = doseFor(n);
      h += '<div class="fert-crop">'
        + '<div class="fert-crop-h">' + esc(isHi() ? c.label_hi : c.label_en)
        + ' <span class="fert-area">' + t('district area ', 'ज़िले का क्षेत्रफल ')
        + num(cropMap[n], 0) + ' ha (DES)</span></div>'
        + c.doses.map(function (e) { return doseRow(e, areaHa); }).join('')
        + '</div>';
    });
    if (without.length) {
      h += '<div class="fert-missing">'
        + t('Dose not available for: ', 'इनके लिए मात्रा उपलब्ध नहीं: ')
        + esc(without.slice(0, 12).join(', '))
        + (without.length > 12 ? ' (+' + (without.length - 12) + ')' : '')
        + '. ' + t('No cited recommendation was found for these crops, so none is shown — a figure borrowed from another crop would not be a real recommendation.',
                   'इन फसलों के लिए कोई उद्धृत संस्तुति नहीं मिली, इसलिए कुछ नहीं दिखाया गया — दूसरी फसल से लिया गया आँकड़ा असली संस्तुति नहीं होगा।')
        + '</div>';
    }
    return h + '</div>';
  }

  function renderEmpty(msgEn, msgHi) {
    var host = el(HOST_ID); if (!host) return;
    host.innerHTML = '<div class="fert-none">' + t(msgEn, msgHi) + '</div>';
  }

  function render(sel, desFile, areaHa) {
    var host = el(HOST_ID); if (!host) return;
    if (!doses) {
      renderEmpty('Fertiliser dose reference could not be loaded.',
                  'उर्वरक मात्रा संदर्भ लोड नहीं हो सका।');
      return;
    }
    var by = cropsBySeason(desFile);
    if (!by) {
      renderEmpty('No DES crop record exists for ' + (sel.district || 'this district')
                  + ', so the crops grown here and their seasons are not known — nothing is assumed.',
                  (sel.district || 'इस ज़िले') + ' के लिए कोई DES फसल रिकॉर्ड नहीं है, '
                  + 'इसलिए यहाँ उगाई जाने वाली फसलें और उनका मौसम ज्ञात नहीं — कुछ भी अनुमान नहीं लगाया गया।');
      return;
    }

    var head = '<div class="fert-head">'
      + '<b>' + esc(sel.district || '') + '</b> · '
      + t('crops and seasons from this district\'s own DES records, ', 'फसलें और मौसम इसी ज़िले के DES रिकॉर्ड से, ')
      + esc(by.year)
      + (areaHa ? ' · ' + t('scaled by your measured field ', 'आपके नापे गए खेत से गुणा ') + num(areaHa, 2) + ' ha'
                : ' · ' + t('per hectare only — measure your field in Mera Khet to see the amount for it',
                            'केवल प्रति हेक्टेयर — अपने खेत की मात्रा देखने के लिए मेरा खेत में खेत नापें'))
      + '</div>';

    var body = seasonBlock('KHARIF (monsoon)', 'खरीफ (मानसून)', by.kharif, areaHa)
      + seasonBlock('RABI (winter)', 'रबी (शीत)', by.rabi, areaHa)
      + seasonBlock('ZAYAD / SUMMER', 'ज़ायद / ग्रीष्म', by.zayad, areaHa);
    if (Object.keys(by.whole_year || {}).length) {
      body += seasonBlock('WHOLE YEAR (perennial / long-duration)', 'पूरे वर्ष (बहुवर्षीय / लंबी अवधि)',
                          by.whole_year, areaHa);
    }

    var md = doses.metadata || {};
    var foot = '<div class="fert-caution">'
      + '<b>' + t('These are blanket doses, not advice for your field.',
                  'ये सामान्य (ब्लैंकेट) मात्राएँ हैं, आपके खेत की सलाह नहीं।') + '</b> '
      + t(md.semantics || '', md.semantics || '')
      + '<br>' + t(md.applicability || '', md.applicability || '')
      + '<br>' + t(md.caution || '', md.caution || '')
      + '</div>';

    host.innerHTML = head + body + foot;
  }

  // ---------------------------------------------------------------------
  function currentArea() {
    var f = window._meraKhetLastField;
    return (f && f.area_ha > 0) ? f.area_ha : null;
  }

  function refresh() {
    var host = el(HOST_ID); if (!host) return;
    var sel = (typeof window.getCurrentSelection === 'function') ? window.getCurrentSelection() : null;
    if (!sel || !sel.district) {
      // Compact prompt only when genuinely nothing is selected (item 12:
      // no long idle text block).
      renderEmpty('Select a district above.', 'ऊपर से ज़िला चुनें।');
      return;
    }
    lastSel = sel;
    loadDoses().then(function () {
      return loadDes(slugify(sel.state), slugify(sel.district));
    }).then(function (des) {
      // Ignore a response that arrived after the user moved on.
      var now = (typeof window.getCurrentSelection === 'function') ? window.getCurrentSelection() : null;
      if (now && now.district !== sel.district) return;
      render(sel, des, currentArea());
    });
  }

  window._vindhyaFertilizerRefresh = refresh;

  function injectPanel() {
    if (el(HOST_ID)) return true;
    var pane = el('pane-agriculture');
    if (!pane) return false;
    var scroll = pane.querySelector('.u-scroll-pane') || pane;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="section-header u-pad-sm"><i class="fa fa-flask u-green-sm"></i>'
      + '<div class="section-title u-fs1">FERTILIZER &amp; CROP RECOMMENDATION</div></div>'
      + '<div id="' + HOST_ID + '" class="fert-panel"></div>';
    scroll.appendChild(wrap);
    return true;
  }

  function boot() {
    if (!injectPanel()) { setTimeout(boot, 300); return; }
    if (typeof window.onDistrictChange === 'function') {
      var orig = window.onDistrictChange;
      window.onDistrictChange = function (dk) { orig(dk); try { refresh(); } catch (e) {} };
    } else {
      setTimeout(boot, 300); return;
    }
    window.addEventListener('vindhya:merakhet-field', function () { try { refresh(); } catch (e) {} });
    // Auto-populate for whatever is ALREADY selected, so opening the panel
    // never shows an idle prompt over a live selection (item 10a/12).
    try { refresh(); } catch (e) {}
  }
  setTimeout(boot, 1200);
})();

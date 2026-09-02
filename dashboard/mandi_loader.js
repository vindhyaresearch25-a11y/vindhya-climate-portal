/*
 * mandi_loader.js — AGMARKNET daily mandi prices (Requirement 13).
 *
 * Reads data/mandi_prices.json, written by scripts/fetch_mandi_prices.py on
 * a GitHub Actions schedule. The browser never calls data.gov.in directly:
 * the API key would be exposed, and GitHub Pages has no backend to proxy it.
 *
 * Every price shown is a published APMC arrival. Nothing is interpolated,
 * carried forward, or estimated. A district with no arrivals shows the
 * upstream note instead of a number.
 */
(function () {
  'use strict';

  var DATA_URL = 'data/mandi_prices.json';
  var _data = null;
  var _loading = false;

  // 30s timeout on every fetch (STANDING ORDERS #5) -- a slow/hung request
  // degrades to the existing .catch() fallback instead of hanging the page.
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

  function inr(v) {
    // Indian digit grouping: 1,23,456
    var s = Math.round(v).toString();
    if (s.length <= 3) return s;
    var last3 = s.slice(-3);
    var rest = s.slice(0, -3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }

  // Bug found in audit: the District dropdown holds the real Survey of
  // India display name (e.g. "24 Paraganas North"), but
  // fetch_mandi_prices.py writes JSON keyed by slug ("24_paraganas_north"
  // -- lowercase, non-alphanumeric runs collapsed to one underscore,
  // matching scripts/national_districts.py's slugify() exactly). Looking
  // the raw dropdown value up directly only worked by coincidence for
  // single-word names where lowercasing happens to equal the slug; every
  // multi-word district silently showed "no data" even when
  // mandi_prices.json had a real row for it.
  function slugify(name) {
    return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function currentDistrict() {
    var ds = document.getElementById('districtSelect');
    return ds && ds.value ? slugify(ds.value) : null;
  }

  function render() {
    var box = document.getElementById('mandi-box');
    if (!box) return;

    if (!_data) {
      box.innerHTML = '<div style="padding:16px;font-size:12px;opacity:.8">' +
        t('Loading mandi prices...', 'मंडी भाव लाए जा रहे हैं...') + '</div>';
      return;
    }

    var dk = currentDistrict();
    if (!dk) {
      box.innerHTML = '<div class="btm-pane-empty"><i class="fa fa-store u-icon-lg-muted"></i>' +
        '<div><b>' + t('Mandi prices', 'मंडी भाव') + '</b><br>' +
        t('Select a district to see local mandi (market) prices', 'स्थानीय मंडी भाव देखने के लिए ज़िला चुनें') + '</div>' +
        '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> ' +
        t('Select district', 'ज़िला चुनें') + '</button></div>';
      return;
    }

    var d = _data.districts && _data.districts[dk];
    if (!d) {
      box.innerHTML = '<div style="padding:var(--space-1);font-size:var(--fs-2)">' +
        t('No data', 'कोई डेटा नहीं') + ' · ' + dk +
        '</div>';
      return;
    }

    var meta = _data.metadata || {};
    var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">';
    h += '<div style="margin-bottom:9px">' + badge(meta.data_quality || 'verified') +
      ' <b>' + t('Mandi prices', 'मंडी भाव') + '</b> &mdash; ' + d.name +
      (d.arrival_dates && d.arrival_dates.length
        ? ' <span style="opacity:.7">(' + d.arrival_dates.join(', ') + ')</span>' : '') +
      '</div>';

    if (!d.records || !d.records.length) {
      h += '<div style="padding:10px 12px;background:rgba(201,168,67,.12);' +
        'border-left:3px solid #c9a843;border-radius:4px;line-height:1.7">' +
        (d.note || t('No arrivals reported.', 'कोई आवक दर्ज नहीं।')) + '</div>';
    } else {
      // AUDIT_FIX_PROMPT.md (2026-08-14, owner's follow-up on item 8): this
      // pane was a plain HTML table only -- real min/modal/max prices per
      // commodity, but no graphical view. Chart is real published APMC
      // data (same rows the table below shows), not a separate estimate.
      h += '<div class="chart-wrap u-h140"><canvas id="chartMandi"></canvas></div>';
      // Group by commodity, keep the best-priced market row per commodity
      h += '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
        '<tr style="text-align:left;font-size:10px;opacity:.65;letter-spacing:.3px">' +
        '<th style="padding:3px 0">' + t('COMMODITY', 'जिंस') + '</th>' +
        '<th>' + t('MARKET', 'मंडी') + '</th>' +
        '<th style="text-align:right">' + t('MIN', 'न्यून') + '</th>' +
        '<th style="text-align:right">' + t('MODAL', 'मॉडल') + '</th>' +
        '<th style="text-align:right">' + t('MAX', 'अधिक') + '</th></tr>';

      d.records.forEach(function (r) {
        h += '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:5px 0">' + r.commodity +
          (r.variety && r.variety !== r.commodity
            ? ' <span style="opacity:.55">' + r.variety + '</span>' : '') + '</td>' +
          '<td style="opacity:.85">' + r.market + '</td>' +
          '<td style="text-align:right;opacity:.75">' + inr(r.min_price) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + inr(r.modal_price) + '</td>' +
          '<td style="text-align:right;opacity:.75">' + inr(r.max_price) + '</td></tr>';
      });
      h += '</table>';
      h += '<div style="margin-top:8px;font-size:11px;opacity:.8">' +
        d.count + ' ' + t('price rows', 'भाव पंक्तियाँ') +
        (d.dropped ? ' &middot; ' + d.dropped + ' ' +
          t('rows dropped as invalid', 'अमान्य पंक्तियाँ हटाई गईं') : '') +
        ' &middot; ' + t('all prices in', 'सभी भाव') + ' <b>&#8377;/' +
        t('quintal', 'क्विंटल') + '</b></div>';
    }

    h += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);' +
      'font-size:10px;opacity:.75;line-height:1.6">' +
      t('Source: ', 'स्रोत: ') + (meta.source || 'AGMARKNET via data.gov.in') +
      '. ' + t('Last updated', 'अंतिम अद्यतन') + ': ' +
      (meta.last_updated || '--') + '. ' +
      t('Prices are published APMC arrivals. No value is interpolated or ' +
        'carried forward from a previous day. Modal price is the most ' +
        'frequently traded price, not an average -- that is true of every ' +
        'row in the table below, which shows each market as published. ' +
        'The chart is the one exception and says so on its own axis: where ' +
        'a commodity traded in more than one market today, its bar is the ' +
        'plain mean of those markets\' modal prices, with the market count ' +
        'shown in the tooltip.',
        'भाव प्रकाशित APMC आवक हैं। कोई मान अनुमानित नहीं है और न ही पिछले दिन से ' +
        'आगे बढ़ाया गया है। मॉडल भाव सर्वाधिक कारोबार वाला भाव है, औसत नहीं -- यह ' +
        'नीचे दी गई तालिका की हर पंक्ति पर लागू होता है। केवल चार्ट अपवाद है: जहाँ ' +
        'एक जिंस आज एक से अधिक मंडी में बिकी, वहाँ उसका बार उन मंडियों के मॉडल भाव ' +
        'का साधारण औसत है, और मंडियों की संख्या टूलटिप में दी गई है।') +
      '</div></div>';

    box.innerHTML = h;
    if (d.records && d.records.length) drawMandiChart(d.records);
  }

  var _mandiChart = null;
  function drawMandiChart(records) {
    if (typeof Chart === 'undefined') return;
    var canvas = document.getElementById('chartMandi');
    if (!canvas) return;
    // One bar per commodity -- average modal price across markets when a
    // commodity has more than one (real numbers, plain arithmetic mean,
    // not an estimate), sorted by price so the chart reads left-to-right
    // high-to-low like a real market board.
    var byCommodity = {};
    records.forEach(function (r) {
      var key = r.commodity;
      if (!byCommodity[key]) byCommodity[key] = { modalSum: 0, n: 0, min: Infinity, max: -Infinity };
      var c = byCommodity[key];
      c.modalSum += r.modal_price; c.n += 1;
      c.min = Math.min(c.min, r.min_price);
      c.max = Math.max(c.max, r.max_price);
    });
    var rows = Object.keys(byCommodity).map(function (name) {
      var c = byCommodity[name];
      return { name: name, modal: c.modalSum / c.n, n: c.n, min: c.min, max: c.max };
    }).sort(function (a, b) { return b.modal - a.modal; }).slice(0, 12);

    if (_mandiChart) { try { _mandiChart.destroy(); } catch (e) {} }
    _mandiChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.name; }),
        datasets: [{
          // Label says "mean across markets" because for any commodity with
          // n > 1 this bar IS an average -- the panel footer's "modal price
          // is not an average" line was, until 2026-09-02, contradicted by
          // this very chart with nothing on screen resolving it.
          label: t('Modal price, mean across markets (₹/quintal)',
                   'मॉडल भाव, मंडियों का औसत (₹/क्विंटल)'),
          data: rows.map(function (r) { return Math.round(r.modal); }),
          backgroundColor: 'rgba(92,195,205,0.55)',
          borderColor: '#5cc3cd',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: function (item) {
                var r = rows[item.dataIndex];
                // Always show how many real market records the bar is built
                // from -- an aggregate without its count is not auditable
                // (FINAL_PROMPT.md Phase 8.2 / docs/METHODOLOGY.md Sec 3.1).
                var basis = (r.n > 1)
                  ? t('mean of ', 'का औसत: ') + r.n + t(' markets', ' मंडी')
                  : t('1 market (as published, not averaged)', '1 मंडी (प्रकाशित, औसत नहीं)');
                return [t('Range: ', 'रेंज: ') + inr(r.min) + ' – ' + inr(r.max), basis];
              }
            }
          }
        },
        scales: {
          x: { ticks: { font: { size: 8 }, autoSkip: false, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
          y: { ticks: { font: { size: 8 } }, grid: { color: 'rgba(138,211,170,0.1)' } }
        }
      }
    });
  }

  function load() {
    if (_loading || _data) { render(); return; }
    _loading = true;
    fetchWithTimeout(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) { _data = j; render(); })
      .catch(function (err) {
        var box = document.getElementById('mandi-box');
        if (box) {
          box.innerHTML = '<div style="padding:16px;font-size:12px;line-height:1.8">' +
            '<b style="color:#c0392b">' +
            t('Mandi prices failed to load', 'मंडी भाव लोड नहीं हुए') + '</b><br>' +
            t('(' + err.message + ')', '(' + err.message + ')') +
            '<br><button id="mandi-retry-btn" style="margin-top:8px;background:#c0392b;color:#fff;' +
            'border:none;border-radius:4px;padding:4px 14px;font-size:11px;font-weight:700;cursor:pointer;">' +
            t('Retry', 'फिर कोशिश करें') + '</button></div>';
          var btn = document.getElementById('mandi-retry-btn');
          if (btn) btn.onclick = function () { _data = null; load(); };
        }
      })
      .finally(function () { _loading = false; });
  }

  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || document.getElementById('pane-mandi')) return;

    var p = el('div', '', '<div id="mandi-box"></div>');
    p.className = 'btm-pane';
    p.id = 'pane-mandi';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !document.getElementById('mandi-tab')) {
      var tab = el('div', '', '<i class="fa fa-indian-rupee-sign"></i>' +
        t('Mandi Prices', 'मंडी भाव'));
      tab.className = 'btm-tab';
      tab.id = 'mandi-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        document.getElementById('pane-mandi').classList.add('active');
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
    try { addPane(); } catch (e) { console.warn('[mandi]', e); }
    // Fetch eagerly (not just on tab click) so window.VindhyaMandi has real
    // data ready the moment the chatbot needs it -- otherwise a farmer who
    // never opens the Mandi Prices tab would get a false "no data recorded"
    // answer purely because the fetch hadn't happened yet.
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 900); });
  } else {
    setTimeout(boot, 900);
  }

  window.VindhyaMandi = {
    reload: function () { _data = null; load(); },
    // Real records for a district (district-select value, any case/spacing
    // -- slugified the same way the data was written), or [] if none
    // loaded/fetched yet. Used by the chatbot's mandi-price answers so it
    // reads the same real AGMARKNET rows the Mandi Prices panel shows,
    // never a separate guessed number.
    getRowsForDistrict: function (districtValue) {
      if (!_data || !_data.districts) return [];
      var d = _data.districts[slugify(districtValue)];
      return (d && d.records) || [];
    }
  };
})();

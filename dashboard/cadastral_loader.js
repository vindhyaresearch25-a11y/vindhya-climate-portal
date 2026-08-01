/*
 * cadastral_loader.js — cadastral (khasra) parcel layer.
 *
 * The previous version generated synthetic parcels with fabricated owner
 * names. That has been removed: land records must come from authoritative
 * sources (MP Bhulekh / Bhu-Naksha, Revenue Department cadastral vectors).
 *
 * Integration plan (see docs/DATA_SOURCES.md):
 *   1. Obtain village cadastral GeoJSON from MP Bhu-Naksha / Revenue Dept.
 *   2. Place it at data/cadastral_<village_lgd>.geojson with fields:
 *      khasra_no, area_ha, land_use, soil_type, irrigation_source.
 *   3. Set CADASTRAL_AVAILABLE = true below and map LGD codes in
 *      CADASTRAL_FILES.
 */
(function () {
  'use strict';

  var CADASTRAL_AVAILABLE = false;
  var CADASTRAL_FILES = {}; // e.g. { "482556": "data/cadastral_482556.geojson" }

  // Keep the API surface index.html expects.
  window._cadParcelsData = [];

  function showUnavailableNotice() {
    var pane = document.getElementById('pane-cadastral');
    if (!pane) return;
    pane.innerHTML =
      '<div style="padding:24px;text-align:center;color:#888;font-size:14px;line-height:1.7">' +
      '<i class="fa fa-draw-polygon" style="font-size:28px;display:block;margin-bottom:10px"></i>' +
      '<b>Cadastral layer pending official data integration</b><br>' +
      'Parcel (khasra) boundaries will be shown once MP Bhulekh / Bhu-Naksha ' +
      'Revenue Department records are integrated. Synthetic parcels are not displayed.<br>' +
      '<span style="font-size:12px">कैडस्ट्रल परत MP भूलेख / भू-नक्शा के आधिकारिक अभिलेख जुड़ने पर उपलब्ध होगी।</span>' +
      '</div>';
  }

  function loadCadastralLayer() {
    if (!CADASTRAL_AVAILABLE) {
      showUnavailableNotice();
      return;
    }
    // Real-data implementation goes here once official GeoJSON is available.
  }

  window.loadCadastralLayer = loadCadastralLayer;
})();

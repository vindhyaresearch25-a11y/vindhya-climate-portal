/*
 * cadastral_loader.js — cadastral (khasra) parcel layer.
 *
 * The previous version generated synthetic parcels with fabricated owner
 * names. That has been removed: land records must come from authoritative
 * sources (MP Bhulekh / Bhu-Naksha, Revenue Department cadastral vectors).
 *
 * dashboard/index.html's #pane-cadastral markup is a deliberate structural
 * DEMONSTRATION of the planned module (see the banner at the top of that
 * pane and docs/AUDIT_2026-08-01.md P1) -- not a bug to be replaced. This
 * loader must not overwrite that pane's innerHTML while CADASTRAL_AVAILABLE
 * is false, or it destroys the demo labelling and schema every time the
 * pane is opened. It previously did exactly that (via showUnavailableNotice,
 * called from both the sidebar and bottom-tab navigation routes), which is
 * what P1 flagged.
 *
 * Integration plan (see docs/DATA_SOURCES.md):
 *   1. Obtain village cadastral GeoJSON from MP Bhu-Naksha / Revenue Dept.
 *   2. Place it at data/cadastral_<village_lgd>.geojson with fields:
 *      khasra_no, area_ha, land_use, soil_type, irrigation_source.
 *   3. Set CADASTRAL_AVAILABLE = true below and map LGD codes in
 *      CADASTRAL_FILES. Once true, loadCadastralLayer() should populate the
 *      existing #cadKhasraSelect etc. with real parcels instead of doing
 *      nothing -- it should NOT go back to wiping the pane.
 */
(function () {
  'use strict';

  var CADASTRAL_AVAILABLE = false;
  var CADASTRAL_FILES = {}; // e.g. { "482556": "data/cadastral_482556.geojson" }

  // Keep the API surface index.html expects.
  window._cadParcelsData = [];

  function loadCadastralLayer() {
    if (!CADASTRAL_AVAILABLE) {
      // No real data yet -- leave index.html's own demo-labelled shell
      // exactly as it is. Nothing to do here until real parcels exist.
      return;
    }
    // Real-data implementation goes here once official GeoJSON is available.
  }

  window.loadCadastralLayer = loadCadastralLayer;
})();

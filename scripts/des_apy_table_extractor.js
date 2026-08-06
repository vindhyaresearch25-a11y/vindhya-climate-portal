/**
 * des_apy_table_extractor.js -- browser console/devtools snippet that
 * parses data.desagri.gov.in's Area/Production/Yield report table into
 * clean JSON, once "View Report" has been clicked with Report Format =
 * Screen View (or Excel -- both render the same HTML table client-side;
 * neither triggers an actual file download in an automated browser
 * session, see docs/CROP_DATA_COVERAGE.md CHARAN 2 for that finding).
 *
 * The table has a 3-row header (crop -> season -> metric, expanded via
 * colSpan) followed by data rows where the State cell only appears on a
 * state's first district row (rowSpan) -- this function handles both.
 * Verified 2026-08-07 against a real national, all-crop, 5-season,
 * single-year (2000-01) query: 10,343 real records, cross-checked by eye
 * against the on-screen table (e.g. Nicobars/Arecanut/Kharif: area
 * 1,254.00 ha, production 2,000.00 t, yield 1.59 t/ha -- matches exactly).
 *
 * Usage (paste into the browser console on the report page after
 * clicking View Report):
 *   const records = extractDesTable();
 *   console.log(records.length, records[0]);
 *   copy(JSON.stringify(records));   // Chrome DevTools' copy() helper --
 *                                     // puts it on the clipboard, paste
 *                                     // into a .json file by hand.
 */
function extractDesTable() {
  const table = document.querySelector('table');
  const trs = Array.from(table.querySelectorAll('tr'));

  function expandRow(tr) {
    const out = [];
    Array.from(tr.children).forEach((td) => {
      const text = td.textContent.trim();
      const span = td.colSpan || 1;
      for (let i = 0; i < span; i++) out.push(text);
    });
    return out;
  }

  // Only row 0 (crop) includes the State/District/Year rowSpan=3 header
  // cells as real <td>s -- rows 1 (season) and 2 (metric) don't repeat
  // them (that is what rowSpan=3 means), so only cropRow needs slice(3).
  const cropRow = expandRow(trs[0]).slice(3);
  const seasonRow = expandRow(trs[1]);
  const metricRow = expandRow(trs[2]);
  const nCols = metricRow.length;

  const records = [];
  let currentState = null;
  for (let r = 3; r < trs.length; r++) {
    const expanded = [];
    Array.from(trs[r].children).forEach((td) => {
      const text = td.textContent.trim();
      const span = td.colSpan || 1;
      for (let i = 0; i < span; i++) expanded.push(text);
    });
    let districtCol, yearCol, dataStart;
    if (expanded.length === 3 + nCols) {
      // This row has its own State cell -- first district row of a state.
      currentState = expanded[0];
      districtCol = expanded[1];
      yearCol = expanded[2];
      dataStart = 3;
    } else {
      // State cell omitted -- continuation of the previous row's rowSpan.
      districtCol = expanded[0];
      yearCol = expanded[1];
      dataStart = 2;
    }
    for (let c = 0; c < nCols; c += 3) {
      const area = expanded[dataStart + c];
      const prod = expanded[dataStart + c + 1];
      const yld = expanded[dataStart + c + 2];
      if (area || prod || yld) {
        records.push({
          state: currentState,
          district: districtCol,
          year: yearCol,
          crop: cropRow[c],
          season: seasonRow[c],
          area_raw: area || null,
          production_raw: prod || null,
          yield_raw: yld || null,
          unit: metricRow[c], // "Area (Hectare)" normally, "Area (Hectare)" +
                               // "Production (Bales)" for cotton/jute -- keep
                               // per-record so unit conversion isn't guessed
        });
      }
    }
  }
  return records;
}

/*
 * village_report_export.js — PDF (phase 2) and Excel (phase 3) exports for
 * the Village Profile & Agricultural Intelligence Report.
 *
 * Consumes the SAME section model village_report.js builds and renders on
 * screen. That is the whole point of the split: an export physically cannot
 * contain a number the live report does not show, nor invent a richer
 * version "for the report". A section that reads "Data not available for the
 * selected location/period" on screen keeps its heading and its number in
 * the PDF and gets a row in the Excel availability sheet, with the same
 * reason text -- per the owner's Data Availability Rule.
 *
 * Libraries are lazy-loaded from cdnjs on first use, following
 * geoai_professional.js's existing loadJsPDF() convention in this codebase
 * (no static <script> tag, no build step, no page-load cost for users who
 * never export). jsPDF + jspdf-autotable give A4, numbered sections, and
 * table headers that repeat across page breaks; SheetJS gives one sheet per
 * section. All three are MIT-licensed.
 */
(function () {
  'use strict';

  var CDN = {
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) {
      return Promise.resolve(window.jspdf.jsPDF);
    }
    var first = (window.jspdf && window.jspdf.jsPDF) ? Promise.resolve() : loadScript(CDN.jspdf);
    return first.then(function () { return loadScript(CDN.autotable); }).then(function () {
      if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF loaded but window.jspdf.jsPDF missing');
      return window.jspdf.jsPDF;
    });
  }
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return loadScript(CDN.xlsx).then(function () {
      if (!window.XLSX) throw new Error('SheetJS loaded but window.XLSX missing');
      return window.XLSX;
    });
  }

  // ---- shared cell handling (mirrors village_report.js exactly) --------
  function cellValue(cell) {
    return (cell && typeof cell === 'object' && !Array.isArray(cell) && 'v' in cell) ? cell.v : cell;
  }
  function cellDec(cell, col) {
    if (cell && typeof cell === 'object' && !Array.isArray(cell) && cell.dec !== undefined) return cell.dec;
    return (col && col.dec !== undefined) ? col.dec : 2;
  }
  function has(v) { return v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !isFinite(v)); }
  var DASH = '—';
  function fmtCell(cell, col) {
    var v = cellValue(cell);
    if (!has(v)) return DASH;
    if (col && col.type === 'num') {
      var n = Number(v);
      if (!isFinite(n)) return DASH;
      var d = cellDec(cell, col);
      return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    return String(v);
  }

  function locationLabel(ctx) {
    if (!ctx) return 'India';
    var p = ['India'];
    if (ctx.stateName) p.push(ctx.stateName);
    if (ctx.districtName) p.push(ctx.districtName);
    if (ctx.blockName) p.push(ctx.blockName);
    if (ctx.gpName) p.push(ctx.gpName + ' (GP)');
    if (ctx.villageName) p.push(ctx.villageName);
    return p.join(' > ');
  }
  function fileStem(ctx) {
    var name = (ctx && (ctx.villageName || ctx.gpName || ctx.blockName || ctx.districtName || ctx.stateName)) || 'india';
    return 'VINDHYA_village_report_' + String(name).replace(/[^A-Za-z0-9]+/g, '_') + '_' +
      new Date().toISOString().slice(0, 10);
  }

  var NO_FAB = 'Every value in this report is read directly from a published source file listed in section 20. ' +
    'Nothing is estimated, interpolated, modelled, or carried over from a neighbouring or parent administrative unit. ' +
    'Where this platform has no real data for a subject, that section states so explicitly — that is the intended ' +
    'output, not a placeholder awaiting a figure.';

  function notReady(kind) {
    alert('Generate the report first: choose a location and press "View Report", then ' + kind + '.');
  }

  // =====================================================================
  // PDF
  // =====================================================================
  function exportPdf(sections, ctx) {
    if (!sections || !sections.length) { notReady('Download PDF'); return; }
    var btns = document.querySelectorAll('.vr-btn');
    loadJsPDF().then(function (jsPDF) {
      var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      var W = doc.internal.pageSize.getWidth();
      var H = doc.internal.pageSize.getHeight();
      var M = 40;                       // page margin
      var generated = new Date().toLocaleString('en-IN');

      // ---------------- Cover page ----------------
      doc.setFillColor(26, 138, 158);
      doc.rect(0, 0, W, 132, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('VINDHYA CLIMATE INTELLIGENCE', M, 52);
      doc.setFontSize(20);
      doc.text('Village Profile &', M, 82);
      doc.text('Agricultural Intelligence Report', M, 106);

      doc.setTextColor(26, 35, 50);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text(locationLabel(ctx), M, 176, { maxWidth: W - 2 * M });

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      doc.setTextColor(90, 106, 122);
      var availCount = sections.filter(function (s) { return s.available; }).length;
      var meta = [
        ['Report level', ctx && ctx.level ? ctx.level.toUpperCase() : 'NONE'],
        ['Generated', generated],
        ['Sections with real data', availCount + ' of ' + sections.length],
        ['Boundary source', 'Survey of India, via National Water Data Portal (NWDP), NWIC'],
        ['Platform', 'VINDHYA Climate Portal']
      ];
      var y = 200;
      meta.forEach(function (m) {
        doc.setFont('helvetica', 'bold'); doc.text(m[0] + ':', M, y);
        doc.setFont('helvetica', 'normal'); doc.text(String(m[1]), M + 130, y, { maxWidth: W - M - 130 - M });
        y += 16;
      });

      // The no-fabrication statement is on the cover on purpose: anyone who
      // receives only the PDF must see it before the first number.
      y += 12;
      doc.setDrawColor(216, 222, 231); doc.line(M, y, W - M, y); y += 18;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 35, 50);
      doc.text('Data integrity statement', M, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 106, 122);
      doc.text(doc.splitTextToSize(NO_FAB, W - 2 * M), M, y);
      y += 62;

      // Contents
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 35, 50);
      doc.text('Contents', M, y); y += 6;
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M },
        head: [['#', 'Section', 'Status', 'Level of the data shown']],
        body: sections.map(function (s) {
          return [String(s.n), s.title, s.available ? 'Available' : 'Not available', s.available ? (s.level || DASH) : DASH];
        }),
        styles: { fontSize: 7.5, cellPadding: 3, textColor: [26, 35, 50], lineColor: [216, 222, 231], lineWidth: 0.4 },
        headStyles: { fillColor: [238, 243, 246], textColor: [90, 106, 122], fontStyle: 'bold', fontSize: 7 },
        alternateRowStyles: { fillColor: [250, 252, 253] },
        columnStyles: { 0: { cellWidth: 18, halign: 'right' }, 2: { cellWidth: 62 }, 3: { cellWidth: 150 } },
        showHead: 'everyPage'
      });

      // ---------------- Sections ----------------
      sections.forEach(function (sec) {
        doc.addPage();
        var cy = M + 6;

        doc.setFillColor(26, 138, 158);
        doc.roundedRect(M, cy - 13, 20, 18, 3, 3, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(String(sec.n), M + 10, cy, { align: 'center' });

        doc.setTextColor(26, 35, 50); doc.setFontSize(12);
        doc.text(sec.title, M + 28, cy, { maxWidth: W - 2 * M - 28 });
        cy += 16;

        if (sec.level) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.setTextColor(sec.available ? 45 : 90, sec.available ? 143 : 106, sec.available ? 92 : 122);
          doc.text((sec.available ? 'Level: ' : '') + (sec.available ? sec.level : 'Not available'), M + 28, cy);
          cy += 14;
        }

        if (!sec.available) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(192, 57, 43);
          doc.text('Data not available for the selected location/period.', M, cy + 6);
          cy += 22;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 106, 122);
          var reason = String(sec.naReason || '').replace(/^Data not available for the selected location[\/a-z]*\.\s*/i, '');
          doc.text(doc.splitTextToSize(reason, W - 2 * M), M, cy);
          cy += 20;
        } else {
          sec.blocks.forEach(function (b) {
            cy = drawBlock(doc, b, cy, M, W, H);
          });
        }

        // Source line at the end of the section's own last page
        if (sec.source) {
          var sy = (doc.lastAutoTable && doc.lastAutoTable.finalY > cy) ? doc.lastAutoTable.finalY + 16 : cy + 6;
          if (sy > H - 60) { doc.addPage(); sy = M + 10; }
          doc.setDrawColor(216, 222, 231); doc.line(M, sy - 8, W - M, sy - 8);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 106, 122);
          doc.text(doc.splitTextToSize('Source · ' + sec.source, W - 2 * M), M, sy);
        }
      });

      // ---------------- Footers (needs the final page count) ----------
      var pages = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 106, 122);
        doc.setDrawColor(216, 222, 231);
        doc.line(M, H - 32, W - M, H - 32);
        doc.text('VINDHYA Climate Intelligence · ' + locationLabel(ctx), M, H - 20, { maxWidth: W - 2 * M - 80 });
        doc.text('Page ' + i + ' of ' + pages, W - M, H - 20, { align: 'right' });
      }

      doc.save(fileStem(ctx) + '.pdf');
    }).catch(function (e) {
      console.warn('[village_report_export] PDF failed:', e);
      alert('Could not build the PDF: ' + e.message + '\n\nThe jsPDF library is loaded from a CDN on first use; ' +
        'this usually means the network blocked it. The on-screen report and Print (which needs no library) still work.');
    }).finally(function () { void btns; });
  }

  // Draw one block, paginating as needed. Returns the new y.
  function drawBlock(doc, b, cy, M, W, H) {
    if (cy > H - 90) { doc.addPage(); cy = M + 10; }

    if (b.type === 'kpi') {
      if (!b.items || !b.items.length) return cy;
      // KPI cards -> a compact 2-column key/value strip (owner's rule: KPI
      // cards are for top-line summary numbers only, never detailed data).
      doc.autoTable({
        startY: cy,
        margin: { left: M, right: M },
        body: b.items.map(function (i) { return [i.label, String(i.value)]; }),
        styles: { fontSize: 8.5, cellPadding: 4, textColor: [26, 35, 50], lineColor: [216, 222, 231], lineWidth: 0.4 },
        columnStyles: { 0: { fontStyle: 'bold', textColor: [90, 106, 122], cellWidth: 200 }, 1: { halign: 'right', fontStyle: 'bold' } },
        theme: 'grid'
      });
      return doc.lastAutoTable.finalY + 12;
    }

    if (b.type === 'table') {
      if (!b.rows || !b.rows.length) return cy;
      var colStyles = {};
      b.cols.forEach(function (c, i) {
        colStyles[i] = { halign: c.align === 'right' ? 'right' : 'left' };
      });
      doc.autoTable({
        startY: cy,
        margin: { left: M, right: M },
        head: [b.cols.map(function (c) { return c.label; })],
        body: b.rows.map(function (r) {
          return r.map(function (cell, i) { return fmtCell(cell, b.cols[i] || {}); });
        }),
        styles: { fontSize: 7.5, cellPadding: 3, textColor: [26, 35, 50], lineColor: [216, 222, 231], lineWidth: 0.4, overflow: 'linebreak' },
        headStyles: { fillColor: [238, 243, 246], textColor: [90, 106, 122], fontStyle: 'bold', fontSize: 7 },
        alternateRowStyles: { fillColor: [250, 252, 253] },
        columnStyles: colStyles,
        // The owner's explicit requirement: table headers repeat on every
        // page a long table spills onto.
        showHead: 'everyPage',
        theme: 'grid'
      });
      var y = doc.lastAutoTable.finalY + 8;
      if (b.caption) {
        if (y > H - 60) { doc.addPage(); y = M + 10; }
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(90, 106, 122);
        var lines = doc.splitTextToSize(b.caption, W - 2 * M);
        doc.text(lines, M, y);
        y += lines.length * 8 + 6;
      }
      return y;
    }

    if (b.type === 'chart') {
      var cv = document.getElementById(b.id);
      if (!cv) return cy;
      var imgW = W - 2 * M, imgH = imgW * 0.42;
      if (cy + imgH > H - 70) { doc.addPage(); cy = M + 10; }
      try {
        // The chart image is the very same canvas already on screen --
        // it cannot show data the live report does not.
        doc.addImage(cv.toDataURL('image/png', 1.0), 'PNG', M, cy, imgW, imgH);
        cy += imgH + 8;
      } catch (e) {
        console.warn('[village_report_export] chart image failed:', b.id, e);
        return cy;
      }
      if (b.caption) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(90, 106, 122);
        var cl = doc.splitTextToSize(b.caption, W - 2 * M);
        doc.text(cl, M, cy);
        cy += cl.length * 8 + 6;
      }
      return cy;
    }

    if (b.type === 'note') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 106, 122);
      var nl = doc.splitTextToSize(b.text, W - 2 * M - 10);
      if (cy + nl.length * 9 > H - 60) { doc.addPage(); cy = M + 10; }
      doc.setFillColor(247, 249, 251);
      doc.rect(M, cy - 8, W - 2 * M, nl.length * 9 + 12, 'F');
      doc.setDrawColor(216, 222, 231);
      doc.setFillColor(216, 222, 231);
      doc.rect(M, cy - 8, 2.5, nl.length * 9 + 12, 'F');
      doc.text(nl, M + 8, cy);
      return cy + nl.length * 9 + 14;
    }

    return cy;
  }

  // =====================================================================
  // EXCEL — one sheet per section that has data, plus a cover sheet and a
  // data-availability sheet listing every section that does not.
  // =====================================================================
  function sheetName(sec) {
    // Excel: <=31 chars, and none of : \ / ? * [ ]
    var base = sec.n + '. ' + String(sec.title).replace(/[:\\\/?*\[\]]/g, '-');
    return base.slice(0, 31);
  }

  function exportExcel(sections, ctx) {
    if (!sections || !sections.length) { notReady('Download Excel'); return; }
    loadXLSX().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      var generated = new Date().toLocaleString('en-IN');
      var availCount = sections.filter(function (s) { return s.available; }).length;

      // ---- Cover sheet
      var cover = [
        ['VINDHYA CLIMATE INTELLIGENCE'],
        ['Village Profile & Agricultural Intelligence Report'],
        [],
        ['Location', locationLabel(ctx)],
        ['Report level', ctx && ctx.level ? ctx.level.toUpperCase() : 'NONE'],
        ['Generated', generated],
        ['Sections with real data', availCount + ' of ' + sections.length],
        ['Boundary source', 'Survey of India, via National Water Data Portal (NWDP), NWIC'],
        [],
        ['Data integrity statement'],
        [NO_FAB],
        [],
        ['#', 'Section', 'Status', 'Level of the data shown', 'Source']
      ];
      sections.forEach(function (s) {
        cover.push([s.n, s.title, s.available ? 'Available' : 'Not available',
          s.available ? (s.level || '') : '', s.source || '']);
      });
      var wsCover = XLSX.utils.aoa_to_sheet(cover);
      wsCover['!cols'] = [{ wch: 6 }, { wch: 52 }, { wch: 15 }, { wch: 46 }, { wch: 70 }];
      XLSX.utils.book_append_sheet(wb, wsCover, 'Cover & Contents');

      // ---- One sheet per available section
      sections.forEach(function (sec) {
        if (!sec.available) return;
        var aoa = [[sec.n + '. ' + sec.title]];
        if (sec.level) aoa.push(['Level of the data shown', sec.level]);
        if (sec.source) aoa.push(['Source', sec.source]);
        aoa.push([]);
        var widths = [];

        sec.blocks.forEach(function (b) {
          if (b.type === 'kpi') {
            if (!b.items || !b.items.length) return;
            aoa.push(['Summary indicator', 'Value']);
            b.items.forEach(function (i) { aoa.push([i.label, i.value]); });
            aoa.push([]);
          } else if (b.type === 'table') {
            if (!b.rows || !b.rows.length) return;
            if (b.caption) { aoa.push([b.caption]); }
            aoa.push(b.cols.map(function (c) {
              // Unit belongs in the header, per the owner's table convention.
              return c.label;
            }));
            b.rows.forEach(function (r) {
              aoa.push(r.map(function (cell, i) {
                var c = b.cols[i] || {};
                var v = cellValue(cell);
                if (!has(v)) return '';
                // Real numbers stay NUMERIC in the spreadsheet (so they can be
                // sorted/charted), never pre-formatted strings.
                if (c.type === 'num') {
                  var n = Number(v);
                  return isFinite(n) ? n : String(v);
                }
                return String(v);
              }));
            });
            aoa.push([]);
            b.cols.forEach(function (c, i) {
              widths[i] = Math.max(widths[i] || 10, Math.min(48, String(c.label).length + 4));
            });
          } else if (b.type === 'note') {
            aoa.push(['Note', b.text]);
            aoa.push([]);
          } else if (b.type === 'chart') {
            // A chart is a rendering of a table that is already in this
            // workbook; the caption records what it plotted.
            aoa.push(['Chart', b.caption || b.id]);
            aoa.push([]);
          }
        });

        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = widths.map(function (w) { return { wch: w }; });
        if (!ws['!cols'].length) ws['!cols'] = [{ wch: 42 }, { wch: 30 }];
        else ws['!cols'][0] = { wch: Math.max(ws['!cols'][0].wch, 42) };
        XLSX.utils.book_append_sheet(wb, ws, sheetName(sec));
      });

      // ---- Data availability sheet (the honest gaps, with reasons)
      var na = sections.filter(function (s) { return !s.available; });
      var naAoa = [
        ['Sections with no real data for this location'],
        ['These are not missing features or stubs. This platform has no real source for them at this ' +
          'administrative level, so no figure is shown. Nothing is estimated to fill the gap.'],
        [],
        ['#', 'Section', 'Reason', 'Candidate real source (not yet integrated)']
      ];
      na.forEach(function (s) {
        naAoa.push([s.n, s.title,
          String(s.naReason || '').replace(/^Data not available for the selected location[\/a-z]*\.\s*/i, ''),
          s.source || '']);
      });
      if (!na.length) naAoa.push(['—', 'Every section resolved to real data for this location.', '', '']);
      var wsNa = XLSX.utils.aoa_to_sheet(naAoa);
      wsNa['!cols'] = [{ wch: 6 }, { wch: 46 }, { wch: 96 }, { wch: 56 }];
      XLSX.utils.book_append_sheet(wb, wsNa, 'Data availability');

      XLSX.writeFile(wb, fileStem(ctx) + '.xlsx');
    }).catch(function (e) {
      console.warn('[village_report_export] Excel failed:', e);
      alert('Could not build the Excel workbook: ' + e.message + '\n\nSheetJS is loaded from a CDN on first use; ' +
        'this usually means the network blocked it.');
    });
  }

  window.VindhyaVillageReportExport = { pdf: exportPdf, excel: exportExcel };
})();

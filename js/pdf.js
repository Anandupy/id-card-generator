/* =============================================================================
 * pdf.js — print-ready export engine.
 *
 * • Renders each card offscreen at export resolution (>= native px → no quality
 *   loss) using the shared CardRenderer, then places PNGs at true physical size.
 * • Modes: single multi-card PDF · individual PDF-per-student (ZIP) · PNG (ZIP).
 * • Page sizes: A4 / Letter / custom · portrait|landscape · optional crop marks.
 * • Async, chunked, cancellable, with progress callbacks — handles thousands of
 *   students without freezing the UI.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  var PAGE_MM = { A4: [210, 297], Letter: [216, 279], A3: [297, 420] };

  function cardMM() { return [IDCS.CARD_W_MM, IDCS.CARD_H_MM]; }

  /* Offscreen render of one card at the requested pixel width. */
  function renderCardCanvas(bgImg, fields, student, pxW) {
    var scale = pxW / IDCS.CARD_W;
    var cv = document.createElement('canvas');
    cv.width = Math.round(IDCS.CARD_W * scale);
    cv.height = Math.round(IDCS.CARD_H * scale);
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    IDCS.Renderer.renderCard(ctx, bgImg, fields, student);
    return cv;
  }

  function pageDims(settings) {
    var mm = settings.pageSize === 'custom'
      ? [settings.customW || 210, settings.customH || 297]
      : (PAGE_MM[settings.pageSize] || PAGE_MM.A4).slice();
    if (settings.orientation === 'landscape') mm = [mm[1], mm[0]];
    return mm;
  }

  /* Grid layout at TRUE physical card size — cards are never scaled to fill a
   * cell, so each one prints at the exact CR80 dimensions. The number of
   * columns/rows is auto-fit to the page and capped by the user's settings.
   * The whole grid is centred on the page. */
  function layout(settings) {
    var pg = pageDims(settings);
    var m = settings.marginMM != null ? settings.marginMM : 8;
    var usableW = pg[0] - m * 2, usableH = pg[1] - m * 2;
    var gx = settings.gapX != null ? settings.gapX : 4, gy = settings.gapY != null ? settings.gapY : 4;
    var cm = cardMM();
    // When cards are rotated 90° their footprint on the page is landscape.
    var cardW = settings.rotateCards ? cm[1] : cm[0];
    var cardH = settings.rotateCards ? cm[0] : cm[1];
    var maxCols = Math.max(1, Math.floor((usableW + gx) / (cardW + gx)));
    var maxRows = Math.max(1, Math.floor((usableH + gy) / (cardH + gy)));
    var cols = Math.min(settings.cols || maxCols, maxCols);
    var rows = Math.min(settings.rows || maxRows, maxRows);
    var gridW = cols * cardW + (cols - 1) * gx;
    var gridH = rows * cardH + (rows - 1) * gy;
    var offX = m + Math.max(0, (usableW - gridW) / 2);
    var offY = m + Math.max(0, (usableH - gridH) / 2);
    return { pg: pg, m: m, cols: cols, rows: rows, gx: gx, gy: gy, rotate: !!settings.rotateCards,
             cardW: cardW, cardH: cardH, offX: offX, offY: offY, perPage: cols * rows };
  }

  /* Return a canvas rotated 90° clockwise (dimensions swapped). */
  function rotate90(cv) {
    var r = document.createElement('canvas');
    r.width = cv.height; r.height = cv.width;
    var ctx = r.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(r.width / 2, r.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return r;
  }

  function cropMarks(pdf, x, y, w, h) {
    var L = 3;
    pdf.setDrawColor(120); pdf.setLineWidth(0.15);
    pdf.line(x, y - L, x, y); pdf.line(x - L, y, x, y);
    pdf.line(x + w, y - L, x + w, y); pdf.line(x + w, y, x + w + L, y);
    pdf.line(x, y + h, x, y + h + L); pdf.line(x - L, y + h, x, y + h);
    pdf.line(x + w, y + h, x + w, y + h + L); pdf.line(x + w + L, y + h, x + w, y + h);
  }

  function nextFrame() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /* ---- Main export -------------------------------------------------------- */
  /* onProgress({done,total}); returns Promise. `control.cancelled` aborts. */
  function generate(state, opts) {
    opts = opts || {};
    var control = opts.control || {};
    var onProgress = opts.onProgress || function () {};
    var students = opts.students || state.students;
    var settings = Object.assign({}, state.settings, opts.settings || {});
    var fields = state.fields;
    if (!students || !students.length) return Promise.resolve(null);
    if (!window.jspdf || !window.jspdf.jsPDF) return Promise.reject(new Error('PDF library not loaded (vendor/jspdf.umd.min.js)'));
    var jsPDF = window.jspdf.jsPDF;

    var pxW = Math.max(IDCS.CARD_W, Math.round(IDCS.CARD_W_MM / 25.4 * (settings.dpi || 300)));

    return IDCS.Renderer.preload(state.templateSrc, students).then(function () {
      var bg = null;
      return IDCS.Renderer.loadImage(state.templateSrc).then(function (img) { bg = img; return runMode(); });

      function runMode() {
        if (settings.mode === 'png-zip') return exportPngZip(bg);
        if (settings.mode === 'individual-pdf') return exportIndividualPdf(bg);
        return exportSinglePdf(bg);
      }

      /* Single multi-card PDF (default) */
      function exportSinglePdf(bg) {
        var L = layout(settings);
        var pdf = new jsPDF({ unit: 'mm', format: settings.pageSize === 'custom' ? L.pg : settings.pageSize.toLowerCase(), orientation: settings.orientation });
        if (settings.pageSize === 'custom') { /* jsPDF custom via format array above */ }
        var i = 0;
        function step() {
          if (control.cancelled) return Promise.resolve(null);
          if (i >= students.length) return Promise.resolve(pdf);
          var onPage = i % L.perPage;
          if (i > 0 && onPage === 0) pdf.addPage();
          var col = onPage % L.cols, row = Math.floor(onPage / L.cols);
          var x = L.offX + col * (L.cardW + L.gx);
          var y = L.offY + row * (L.cardH + L.gy);
          var cv = renderCardCanvas(bg, fields, students[i], pxW);
          if (L.rotate) cv = rotate90(cv);
          pdf.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', x, y, L.cardW, L.cardH, undefined, 'FAST');
          if (settings.cropMarks) cropMarks(pdf, x, y, L.cardW, L.cardH);
          i++;
          onProgress({ done: i, total: students.length });
          return (i % 6 === 0 ? nextFrame() : Promise.resolve()).then(step);
        }
        return step().then(function (p) { return p ? { blob: p.output('blob'), name: fileName(state) + '.pdf' } : null; });
      }

      /* One PDF per student, bundled in a ZIP */
      function exportIndividualPdf(bg) {
        var zip = new JSZip();
        var cm = cardMM(), i = 0;
        function step() {
          if (control.cancelled) return Promise.resolve(null);
          if (i >= students.length) return zip.generateAsync({ type: 'blob' }).then(function (b) { return { blob: b, name: fileName(state) + '_individual_pdf.zip' }; });
          var s = students[i];
          var pdf = new jsPDF({ unit: 'mm', format: [cm[0], cm[1]], orientation: 'portrait' });
          var cv = renderCardCanvas(bg, fields, s, pxW);
          pdf.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, cm[0], cm[1], undefined, 'FAST');
          zip.file(safe(s.data.cid || ('card' + (i + 1))) + '.pdf', pdf.output('blob'));
          i++; onProgress({ done: i, total: students.length });
          return (i % 6 === 0 ? nextFrame() : Promise.resolve()).then(step);
        }
        return step();
      }

      /* PNG per student, bundled in a ZIP */
      function exportPngZip(bg) {
        var zip = new JSZip(), i = 0;
        function step() {
          if (control.cancelled) return Promise.resolve(null);
          if (i >= students.length) return zip.generateAsync({ type: 'blob' }).then(function (b) { return { blob: b, name: fileName(state) + '_png.zip' }; });
          var s = students[i];
          var cv = renderCardCanvas(bg, fields, s, pxW);
          var dataUrl = cv.toDataURL('image/png');
          zip.file(safe(s.data.cid || ('card' + (i + 1))) + '.png', dataUrl.split(',')[1], { base64: true });
          i++; onProgress({ done: i, total: students.length });
          return (i % 5 === 0 ? nextFrame() : Promise.resolve()).then(step);
        }
        return step();
      }
    });
  }

  function fileName(state) { return safe(state.projectName || 'ID_Cards'); }
  function safe(s) { return String(s).replace(/[^\w\-]+/g, '_').slice(0, 60); }

  function download(result) {
    if (!result) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(result.blob); a.download = result.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  IDCS.PDF = { generate: generate, download: download, layout: layout, pageDims: pageDims };
})(window.IDCS = window.IDCS || {});

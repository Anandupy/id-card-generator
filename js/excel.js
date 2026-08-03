/* =============================================================================
 * excel.js — parse XLSX/XLS/CSV (SheetJS), auto-detect columns, auto-map to
 * template fields, and build the student list. No column-count limit.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  // Convert Excel serial dates / Date objects to a readable dd-Mmm-yyyy string.
  function fmtCell(v) {
    if (v == null) return '';
    if (v instanceof Date) return toDMY(v);
    return String(v).trim();
  }
  function toDMY(d) {
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return ('0' + d.getDate()).slice(-2) + '-' + m[d.getMonth()] + '-' + d.getFullYear();
  }

  function parseWorkbook(arrayBuffer) {
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    var sheet = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, dateNF: 'dd-mmm-yyyy' });
    // drop fully empty leading rows
    while (rows.length && rows[0].every(function (c) { return String(c).trim() === ''; })) rows.shift();
    if (!rows.length) return { columns: [], records: [] };

    // Detect the header row: exports often prepend a title banner row (one cell)
    // above the real headers. Pick the row (within the first 15) with the most
    // non-empty cells; the normal single-header sheet still resolves to row 0.
    var hdrIdx = 0, best = -1;
    for (var i = 0; i < Math.min(15, rows.length); i++) {
      var count = rows[i].filter(function (c) { return String(c).trim() !== ''; }).length;
      if (count > best) { best = count; hdrIdx = i; }
    }
    var headers = rows[hdrIdx].map(function (h, i) { return String(h).trim() || ('Column ' + (i + 1)); });

    var records = [];
    for (var r = hdrIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.every(function (c) { return String(c).trim() === ''; })) continue;
      var rec = {};
      headers.forEach(function (h, i) { rec[h] = fmtCell(row[i]); });
      records.push(rec);
    }
    return { columns: headers, records: records };
  }

  /* Best-guess mapping from detected columns to field binds.
   * Aliases are tried in priority order (most specific first), exact matches
   * beat substring matches, and each column is claimed by at most one field —
   * so "C-ID" wins over "Roll No" for the cid field. */
  function autoMap(columns) {
    var mapping = {};
    var used = {};
    var normCols = columns.map(function (c) { return { raw: c, n: U.norm(c) }; });

    // Phase 1: exact alias matches, in alias-priority order.
    Object.keys(IDCS.FIELD_ALIASES).forEach(function (bind) {
      var aliases = IDCS.FIELD_ALIASES[bind];
      for (var i = 0; i < aliases.length; i++) {
        var a = U.norm(aliases[i]);
        var hit = normCols.find(function (c) { return !used[c.raw] && c.n === a; });
        if (hit) { mapping[bind] = hit.raw; used[hit.raw] = true; return; }
      }
    });
    // Phase 2: substring fallback for anything still unmapped.
    Object.keys(IDCS.FIELD_ALIASES).forEach(function (bind) {
      if (mapping[bind]) return;
      var aliases = IDCS.FIELD_ALIASES[bind];
      for (var i = 0; i < aliases.length; i++) {
        var a = U.norm(aliases[i]);
        var hit = normCols.find(function (c) {
          return !used[c.raw] && c.n.length > 1 && (c.n.indexOf(a) !== -1 || a.indexOf(c.n) !== -1);
        });
        if (hit) { mapping[bind] = hit.raw; used[hit.raw] = true; return; }
      }
    });
    return mapping;
  }

  /* Combine two parent numbers onto one line, handling every empty/present
   * case: "a, b" | "a" | "b" | "" — comma + single space, no stray commas. */
  function combineMobile(p1, p2) {
    return [p1, p2].map(function (v) { return String(v == null ? '' : v).trim(); })
                   .filter(function (v) { return v.length > 0; }).join(', ');
  }

  /* Build normalised student objects from records + mapping. Unmapped columns
   * are preserved under their raw header so custom fields still work. */
  function buildStudents(records, mapping) {
    return records.map(function (rec, idx) {
      var data = {};
      // mapped canonical keys
      Object.keys(mapping).forEach(function (bind) { data[bind] = rec[mapping[bind]] || ''; });
      // keep every raw column too (normalised key) for custom fields / matching
      Object.keys(rec).forEach(function (col) { data[U.norm(col)] = rec[col]; data['col:' + col] = rec[col]; });
      // Combine Parent 1 + Parent 2 into the single "Mob No" value.
      data.mob = combineMobile(mapping.mob ? rec[mapping.mob] : data.mob, mapping.mob2 ? rec[mapping.mob2] : '');
      if (!data.cid) data.cid = data.admissionno || data.rollno || data.id || String(idx + 1);
      return { id: 'stu' + idx, rowIndex: idx, data: data, photoUrl: null, photoFile: null, overrides: {} };
    });
  }

  IDCS.Excel = {
    load: function (file) {
      return U.fileToArrayBuffer(file).then(function (buf) {
        var parsed = parseWorkbook(new Uint8Array(buf));
        var mapping = autoMap(parsed.columns);
        var students = buildStudents(parsed.records, mapping);
        return { columns: parsed.columns, mapping: mapping, students: students };
      });
    },
    autoMap: autoMap,
    buildStudents: buildStudents,
    combineMobile: combineMobile
  };
})(window.IDCS = window.IDCS || {});

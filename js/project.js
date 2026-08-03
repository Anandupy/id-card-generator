/* =============================================================================
 * project.js — save/load the whole project (.idcs JSON) and data exports
 * (CSV / Excel / JSON). A project remembers template, mapping, fields, photos,
 * per-student edits, and settings so work can be resumed later.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  /* Serialise everything, including photo data URLs (so the project is portable). */
  function save(state) {
    var payload = {
      _format: 'idcs-project', _version: 1, savedAt: new Date().toISOString(),
      projectName: state.projectName,
      templateSrc: state.templateSrc,
      templateNative: state.templateNative,
      fields: state.fields,
      columns: state.columns,
      mapping: state.mapping,
      settings: state.settings,
      theme: state.theme,
      students: state.students.map(function (s) {
        return { id: s.id, rowIndex: s.rowIndex, data: s.data, photoUrl: s.photoUrl || null, overrides: s.overrides || {} };
      })
    };
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    trigger(blob, safe(state.projectName) + '.idcs');
  }

  function load(file) {
    return U.fileToArrayBuffer(file).then(function (buf) {
      var text = new TextDecoder().decode(buf);
      var p = JSON.parse(text);
      if (p._format !== 'idcs-project') throw new Error('Not an ID Card Studio project file');
      p.students = (p.students || []).map(function (s) { s.photoFile = null; s.overrides = s.overrides || {}; return s; });
      return p;
    });
  }

  /* ---- data exports -------------------------------------------------------- */
  function exportJSON(state) {
    var rows = state.students.map(function (s) { return s.data; });
    trigger(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), safe(state.projectName) + '_data.json');
  }

  function exportCSV(state) {
    var cols = state.columns.length ? state.columns : Object.keys(state.students[0] ? state.students[0].data : {});
    var lines = [cols.map(csv).join(',')];
    state.students.forEach(function (s) {
      lines.push(cols.map(function (c) { return csv(s.data['col:' + c] != null ? s.data['col:' + c] : (s.data[U.norm(c)] || '')); }).join(','));
    });
    trigger(new Blob([lines.join('\n')], { type: 'text/csv' }), safe(state.projectName) + '_data.csv');
  }

  function exportXLSX(state) {
    var cols = state.columns.length ? state.columns : Object.keys(state.students[0] ? state.students[0].data : {});
    var aoa = [cols];
    state.students.forEach(function (s) { aoa.push(cols.map(function (c) { return s.data['col:' + c] != null ? s.data['col:' + c] : (s.data[U.norm(c)] || ''); })); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, safe(state.projectName) + '_data.xlsx');
  }

  function csv(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function safe(s) { return String(s || 'project').replace(/[^\w\-]+/g, '_').slice(0, 60); }
  function trigger(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  IDCS.Project = { save: save, load: load, exportJSON: exportJSON, exportCSV: exportCSV, exportXLSX: exportXLSX };
})(window.IDCS = window.IDCS || {});

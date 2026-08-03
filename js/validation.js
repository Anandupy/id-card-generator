/* =============================================================================
 * validation.js — pre-flight data quality report.
 * Flags: missing photo, duplicate CID/admission, empty mandatory fields,
 * invalid dates, unmatched/extra/unused photos.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  var MANDATORY = ['name', 'std'];   // tweakable per deployment

  function run(state) {
    var issues = [];
    var seenCid = {}, seenName = {};
    var students = state.students;

    students.forEach(function (s, i) {
      var who = s.data.name || ('Row ' + (i + 1));

      MANDATORY.forEach(function (m) {
        if (!String(s.data[m] || '').trim())
          issues.push({ level: 'error', row: i, who: who, msg: 'Missing mandatory field: ' + m });
      });

      if (!s.photoUrl)
        issues.push({ level: 'warn', row: i, who: who, msg: 'No photo matched' });

      var cid = U.norm(s.data.cid);
      if (cid) {
        if (seenCid[cid] != null)
          issues.push({ level: 'error', row: i, who: who, msg: 'Duplicate C-ID / admission "' + s.data.cid + '" (also row ' + (seenCid[cid] + 1) + ')' });
        else seenCid[cid] = i;
      }

      var nm = U.norm(s.data.name);
      if (nm) { if (seenName[nm] != null) issues.push({ level: 'info', row: i, who: who, msg: 'Duplicate student name' }); else seenName[nm] = i; }

      if (s.data.dob && !U.isValidDate(s.data.dob))
        issues.push({ level: 'warn', row: i, who: who, msg: 'DOB may be invalid: "' + s.data.dob + '"' });
    });

    (state.unmatchedPhotos || []).forEach(function (name) {
      issues.push({ level: 'warn', row: -1, who: name, msg: 'Extra photo not matched to any student' });
    });

    var counts = {
      error: issues.filter(function (x) { return x.level === 'error'; }).length,
      warn: issues.filter(function (x) { return x.level === 'warn'; }).length,
      info: issues.filter(function (x) { return x.level === 'info'; }).length
    };
    return { issues: issues, counts: counts, students: students.length,
             withPhoto: students.filter(function (s) { return !!s.photoUrl; }).length };
  }

  IDCS.Validation = { run: run, MANDATORY: MANDATORY };
})(window.IDCS = window.IDCS || {});

/* =============================================================================
 * photos.js — bulk folder photo import with automatic student matching.
 *
 * Matching order (first hit wins), all normalised:
 *   filename-stem  ==  cid / admission / roll / studentId / grNo / id
 * Also supports "<key> anything.jpg" (stem's leading token) as a fallback.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  var IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;

  function stem(name) { return name.replace(/\.[^.]+$/, ''); }

  /* Build a lookup of every candidate key a student can be matched by. */
  function studentKeys(student) {
    var keys = [];
    IDCS.PHOTO_MATCH_KEYS.forEach(function (k) {
      var v = student.data[k];
      if (v) keys.push(U.norm(v));
    });
    // also raw columns that look like ids
    Object.keys(student.data).forEach(function (k) {
      if (/(id|adm|roll|grno)/.test(k) && student.data[k]) keys.push(U.norm(student.data[k]));
    });
    return keys;
  }

  /* Match a list of image Files to students. Returns matched count + leftovers. */
  function match(files, students) {
    var imgs = files.filter(function (f) { return IMG_RE.test(f.name); });
    // index students by every key
    var index = {};
    students.forEach(function (s) {
      studentKeys(s).forEach(function (k) { if (k && !index[k]) index[k] = s; });
    });

    var matched = 0, unmatched = [];
    var jobs = imgs.map(function (file) {
      var st = U.norm(stem(file.name));
      var target = index[st];
      if (!target) {
        // fallback: leading numeric/alpha token before space/underscore/dash
        var token = U.norm(stem(file.name).split(/[\s_\-]+/)[0]);
        target = index[token];
      }
      if (!target) { unmatched.push(file.name); return Promise.resolve(); }
      return U.fileToDataURL(file).then(function (url) {
        if (!target.photoUrl) { matched++; }
        target.photoUrl = url; target.photoFile = file;
      });
    });

    return Promise.all(jobs).then(function () {
      return { matched: matched, unmatched: unmatched, total: imgs.length };
    });
  }

  /* Attach a single replacement photo to a specific student. */
  function setPhoto(student, file) {
    return U.fileToDataURL(file).then(function (url) { student.photoUrl = url; student.photoFile = file; return url; });
  }

  IDCS.Photos = { match: match, setPhoto: setPhoto, IMG_RE: IMG_RE };
})(window.IDCS = window.IDCS || {});
